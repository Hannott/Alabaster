"""A fake Moonraker, for developing against several printers at once.

It answers the JSON-RPC methods Alabaster actually calls, pushes the same
notifications a real printer pushes, and serves an MJPEG camera and a slicer
thumbnail over HTTP — enough for the Farm rail, the dashboard's Print and
Temperatures cards, and the job queue to be exercised without a machine.

It is a **simulator, not an emulator**: no Klipper, no G-code, no kinematics. A
scenario decides what the printer pretends to be doing, and the numbers move
plausibly from there. Anything Alabaster asks for that is not implemented gets
a JSON-RPC "Method not found", which is what a real Moonraker answers for a
component that is not configured — so an unimplemented call reads as an absent
feature rather than as a broken server.

Configured entirely from the environment; see `compose.fake-printers.yaml`.
"""

from __future__ import annotations

import asyncio
import io
import json
import math
import os
import random
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from aiohttp import web, WSMsgType
from PIL import Image, ImageDraw

# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------


def env_flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass
class Config:
    name: str = os.environ.get("PRINTER_NAME", "Fake printer")
    port: int = env_int("PORT", 7125)
    # printing · paused · idle · complete · error · shutdown
    scenario: str = os.environ.get("SCENARIO", "printing").strip().lower()
    filename: str = os.environ.get("FILENAME", "bracket_v3.gcode")
    # How long a simulated print takes end to end. Short by default so progress
    # is visibly moving while you look at it.
    print_seconds: int = env_int("PRINT_SECONDS", 900)
    layers: int = env_int("LAYERS", 214)
    queue: int = env_int("QUEUE", 3)
    queue_paused: bool = env_flag("QUEUE_PAUSED", False)
    has_camera: bool = env_flag("CAMERA", True)
    has_power: bool = env_flag("POWER", False)
    has_spoolman: bool = env_flag("SPOOLMAN", False)
    material: str = os.environ.get("MATERIAL", "PLA")
    color: str = os.environ.get("COLOR", "E69F00")
    hotend_target: float = float(os.environ.get("HOTEND_TARGET", 220))
    bed_target: float = float(os.environ.get("BED_TARGET", 60))
    """Refuse every websocket whose Origin is not listed, the way Moonraker's
    `cors_domains` does. Set to `none` to reproduce the refused-origin column
    without touching a real printer's configuration."""
    cors: str = os.environ.get("CORS", "all").strip().lower()


CONFIG = Config()
STARTED_AT = time.monotonic()

MATERIAL_TEMPERATURES = {
    "PLA": (215.0, 60.0),
    "PETG": (240.0, 85.0),
    "ABS": (250.0, 105.0),
    "ASA": (255.0, 105.0),
    "TPU": (230.0, 45.0),
}


# --------------------------------------------------------------------------
# Simulated machine
# --------------------------------------------------------------------------


@dataclass
class Machine:
    """Everything the fake printer pretends to be, in one mutable place."""

    state: str = "standby"
    klippy_state: str = "ready"
    filename: str = ""
    started_at: float = 0.0
    elapsed_at_pause: float = 0.0
    hotend: float = 24.0
    bed: float = 23.0
    hotend_target: float = 0.0
    bed_target: float = 0.0
    queue: list[dict[str, Any]] = field(default_factory=list)
    queue_state: str = "ready"
    power_on: bool = True
    next_job_id: int = 1

    def start_print(self, filename: str) -> None:
        self.state = "printing"
        self.filename = filename
        self.started_at = time.monotonic()
        self.elapsed_at_pause = 0.0
        hotend, bed = MATERIAL_TEMPERATURES.get(
            CONFIG.material.upper(), (CONFIG.hotend_target, CONFIG.bed_target)
        )
        self.hotend_target = hotend
        self.bed_target = bed

    @property
    def elapsed(self) -> float:
        if self.state == "printing":
            return self.elapsed_at_pause + (time.monotonic() - self.started_at)
        return self.elapsed_at_pause

    @property
    def progress(self) -> float:
        if self.filename == "":
            return 0.0
        if self.state in {"complete", "cancelled"}:
            return 1.0 if self.state == "complete" else min(1.0, self.elapsed / CONFIG.print_seconds)
        return max(0.0, min(1.0, self.elapsed / CONFIG.print_seconds))

    @property
    def layer(self) -> int:
        return max(1, min(CONFIG.layers, round(self.progress * CONFIG.layers)))


MACHINE = Machine()


def apply_scenario() -> None:
    """Puts the machine into the state this instance was asked to pretend."""
    machine, scenario = MACHINE, CONFIG.scenario

    for index in range(CONFIG.queue):
        machine.queue.append(
            {
                "filename": f"queued_part_{index + 1}.gcode",
                "job_id": f"{machine.next_job_id:08X}",
                "time_added": time.time() - 600 + index,
                "time_in_queue": 600 - index,
            }
        )
        machine.next_job_id += 1
    machine.queue_state = "paused" if CONFIG.queue_paused else "ready"

    if scenario in {"printing", "paused"}:
        machine.start_print(CONFIG.filename)
        # Start part-way in, so progress and a remaining time are meaningful the
        # moment the page opens rather than after a wait.
        machine.started_at -= CONFIG.print_seconds * 0.35
        if scenario == "paused":
            machine.elapsed_at_pause = machine.elapsed
            machine.state = "paused"
    elif scenario == "complete":
        machine.state = "complete"
        machine.filename = CONFIG.filename
        machine.elapsed_at_pause = CONFIG.print_seconds
    elif scenario == "error":
        machine.state = "error"
        machine.filename = CONFIG.filename
        machine.elapsed_at_pause = CONFIG.print_seconds * 0.4
    elif scenario == "shutdown":
        machine.klippy_state = "shutdown"
    # `idle` needs nothing: a machine that has never printed.


def advance(delta: float) -> None:
    """One tick of physics-shaped fiction: heaters chase targets, prints end."""
    machine = MACHINE

    for attribute, target_attribute, ambient in (
        ("hotend", "hotend_target", 24.0),
        ("bed", "bed_target", 23.0),
    ):
        current = getattr(machine, attribute)
        target = getattr(machine, target_attribute)
        goal = target if target > 0 else ambient
        # Approach the goal, then wobble around it the way a real PID loop does.
        current += (goal - current) * min(1.0, delta * 0.35)
        if abs(goal - current) < 2.0:
            current += math.sin(time.monotonic() * 1.7) * 0.12 + random.uniform(-0.05, 0.05)
        setattr(machine, attribute, round(current, 2))

    if machine.state == "printing" and machine.progress >= 1.0:
        machine.state = "complete"
        machine.elapsed_at_pause = CONFIG.print_seconds
        machine.hotend_target = 0.0
        machine.bed_target = 0.0
        # The queue is what a farm page is watching: rolling straight into the
        # next job is the behaviour worth simulating.
        if machine.queue and machine.queue_state == "ready":
            job = machine.queue.pop(0)
            machine.start_print(job["filename"])


# --------------------------------------------------------------------------
# Printer objects
# --------------------------------------------------------------------------


def printer_objects() -> dict[str, dict[str, Any]]:
    machine = MACHINE
    progress = machine.progress
    return {
        "webhooks": {
            "state": machine.klippy_state,
            "state_message": (
                "Printer is ready"
                if machine.klippy_state == "ready"
                else "MCU 'mcu' shutdown: Timer too close (simulated)"
            ),
        },
        "print_stats": {
            "state": machine.state,
            "filename": machine.filename,
            "print_duration": round(machine.elapsed, 2),
            "total_duration": round(machine.elapsed + 42, 2),
            "filament_used": round(progress * 3200, 2),
            "message": "",
            "info": {
                "current_layer": machine.layer if machine.filename else None,
                "total_layer": CONFIG.layers if machine.filename else None,
            },
        },
        "virtual_sdcard": {
            "progress": round(progress, 4),
            "is_active": machine.state == "printing",
            "file_position": int(progress * 3_554_031),
            "file_size": 3_554_031,
        },
        "display_status": {
            "progress": round(progress, 4),
            "message": None,
        },
        "extruder": {
            "temperature": machine.hotend,
            "target": machine.hotend_target,
            "power": 0.4 if machine.hotend_target > 0 else 0.0,
            "can_extrude": machine.hotend > 170,
        },
        "heater_bed": {
            "temperature": machine.bed,
            "target": machine.bed_target,
            "power": 0.3 if machine.bed_target > 0 else 0.0,
        },
        "toolhead": {
            "homed_axes": "xyz" if machine.state in {"printing", "paused"} else "",
            "position": [120.0, 110.0, round(progress * 60, 2), 0.0],
            "axis_minimum": [0.0, 0.0, 0.0, 0.0],
            "axis_maximum": [300.0, 300.0, 340.0, 0.0],
            "max_velocity": 300.0,
            "max_accel": 3000.0,
            "extruder": "extruder",
        },
        "gcode_move": {
            "speed_factor": 1.0,
            "extrude_factor": 1.0,
            "homing_origin": [0.0, 0.0, 0.0, 0.0],
            "gcode_position": [120.0, 110.0, round(progress * 60, 2), 0.0],
        },
        "fan": {"speed": 1.0 if machine.state == "printing" else 0.0},
        "idle_timeout": {
            "state": "Printing" if machine.state == "printing" else "Idle",
            "printing_time": round(machine.elapsed, 2),
        },
    }


def select(objects: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """Answers a subscription the way Moonraker does: only what was asked for,
    only the named fields, and silence for an object this machine does not
    have — never an error, because a client asking for an optional object is
    asking a question, not making a mistake."""
    available = printer_objects()
    if not objects:
        return available

    status: dict[str, dict[str, Any]] = {}
    for name, fields in objects.items():
        if name not in available:
            continue
        source = available[name]
        if fields is None:
            status[name] = source
        else:
            status[name] = {key: source[key] for key in fields if key in source}
    return status


# --------------------------------------------------------------------------
# Camera
# --------------------------------------------------------------------------


def render_frame() -> bytes:
    """A frame that is obviously live: the name, the state, a sweeping bar and a
    clock. Drawn rather than served from a file so it is impossible to mistake a
    frozen stream for a working one."""
    width, height = 640, 360
    image = Image.new("RGB", (width, height), (18, 21, 28))
    draw = ImageDraw.Draw(image)

    for y in range(height):
        shade = int(18 + (y / height) * 26)
        draw.line([(0, y), (width, y)], fill=(shade, shade + 3, shade + 10))

    phase = time.monotonic() % 4 / 4
    x = int(phase * width)
    draw.rectangle([x - 60, 0, x + 60, height], fill=(30, 44, 66))

    draw.rectangle([40, 40, width - 40, height - 40], outline=(90, 110, 140), width=2)
    draw.text((56, 56), CONFIG.name, fill=(235, 240, 250))
    draw.text((56, 76), f"{MACHINE.state.upper()}  ·  {MACHINE.progress * 100:.0f}%", fill=(140, 190, 240))
    draw.text((56, 96), time.strftime("%H:%M:%S"), fill=(150, 160, 175))

    # A "nozzle" that tracks progress, so the picture changes with the print.
    nozzle_x = 60 + int(MACHINE.progress * (width - 160))
    draw.rectangle([nozzle_x, 150, nozzle_x + 18, 190], fill=(220, 120, 40))
    draw.rectangle([60, 250, width - 60, 268], outline=(90, 110, 140))
    draw.rectangle([62, 252, 62 + int(MACHINE.progress * (width - 126)), 266], fill=(90, 150, 220))

    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=70)
    return buffer.getvalue()


def render_thumbnail() -> bytes:
    """Stands in for the slicer's embedded preview."""
    size = 300
    image = Image.new("RGB", (size, size), (24, 28, 36))
    draw = ImageDraw.Draw(image)
    draw.ellipse([40, 40, size - 40, size - 40], outline=(90, 150, 220), width=6)
    draw.rectangle([90, 90, size - 90, size - 90], fill=(60, 90, 130))
    draw.text((20, size - 30), CONFIG.name, fill=(200, 210, 225))
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


# --------------------------------------------------------------------------
# JSON-RPC
# --------------------------------------------------------------------------

SUBSCRIBERS: dict[web.WebSocketResponse, dict[str, Any] | None] = {}


def rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def server_info() -> dict[str, Any]:
    components = ["server", "file_manager", "machine", "database", "job_queue", "webcam"]
    if CONFIG.has_power:
        components.append("power")
    if CONFIG.has_spoolman:
        components.append("spoolman")
    return {
        "klippy_connected": MACHINE.klippy_state != "disconnected",
        "klippy_state": MACHINE.klippy_state,
        "components": components,
        "failed_components": [],
        "registered_directories": ["gcodes", "config", "logs"],
        "warnings": [],
        "websocket_count": len(SUBSCRIBERS),
        "moonraker_version": "v0.9.3-fake",
        "api_version": [1, 5, 0],
    }


def webcams() -> dict[str, Any]:
    if not CONFIG.has_camera:
        return {"webcams": []}
    return {
        "webcams": [
            {
                "name": f"{CONFIG.name} cam",
                "uid": "fake-cam-1",
                "enabled": True,
                "icon": "mdiWebcam",
                "location": "printer",
                "service": "mjpegstreamer",
                "target_fps": 15,
                "target_fps_idle": 5,
                "stream_url": "/webcam/stream",
                "snapshot_url": "/webcam/snapshot",
                "flip_horizontal": False,
                "flip_vertical": False,
                "rotation": 0,
                "aspect_ratio": "16:9",
                "extra_data": {},
                "source": "database",
            }
        ]
    }


def spool() -> dict[str, Any]:
    return {
        "id": 1,
        "registered": "2026-01-01T00:00:00Z",
        "filament": {
            "id": 1,
            "name": f"{CONFIG.material} — simulated",
            "material": CONFIG.material,
            "color_hex": CONFIG.color,
            "weight": 1000,
            "spool_weight": 200,
            "density": 1.24,
            "diameter": 1.75,
            "vendor": {"id": 1, "name": "Fake Filaments"},
        },
        "remaining_weight": round(820 - MACHINE.progress * 120, 1),
        "used_weight": round(180 + MACHINE.progress * 120, 1),
        "remaining_length": 240000,
        "used_length": 60000,
        "archived": False,
    }


def handle_rpc(method: str, params: dict[str, Any], socket: web.WebSocketResponse) -> Any:
    machine = MACHINE

    if method == "server.connection.identify":
        return {"connection_id": abs(hash(id(socket))) % 100000}
    if method in {"server.info", "server.config"}:
        return server_info() if method == "server.info" else {"config": {}}
    if method == "printer.info":
        return {
            "state": machine.klippy_state,
            "state_message": printer_objects()["webhooks"]["state_message"],
            "hostname": CONFIG.name,
            "software_version": "v0.13.0-fake",
        }
    if method in {"printer.objects.subscribe", "printer.objects.query"}:
        if method == "printer.objects.subscribe":
            SUBSCRIBERS[socket] = params.get("objects")
        return {"eventtime": time.monotonic(), "status": select(params.get("objects"))}
    if method == "printer.objects.list":
        return {"objects": list(printer_objects().keys())}

    if method == "server.webcams.list":
        return webcams()

    if method == "server.job_queue.status":
        return {"queued_jobs": machine.queue, "queue_state": machine.queue_state}
    if method == "server.job_queue.pause":
        machine.queue_state = "paused"
        return {"queued_jobs": machine.queue, "queue_state": machine.queue_state}
    if method == "server.job_queue.start":
        machine.queue_state = "ready"
        return {"queued_jobs": machine.queue, "queue_state": machine.queue_state}
    if method == "server.job_queue.delete_job":
        if params.get("all"):
            machine.queue.clear()
        else:
            ids = set(params.get("job_ids") or [])
            machine.queue = [job for job in machine.queue if job["job_id"] not in ids]
        return {"queued_jobs": machine.queue, "queue_state": machine.queue_state}
    if method == "server.job_queue.post_job":
        for filename in params.get("filenames") or []:
            machine.queue.append(
                {
                    "filename": filename,
                    "job_id": f"{machine.next_job_id:08X}",
                    "time_added": time.time(),
                    "time_in_queue": 0,
                }
            )
            machine.next_job_id += 1
        return {"queued_jobs": machine.queue, "queue_state": machine.queue_state}

    if method == "server.files.metadata":
        filename = params.get("filename", "")
        return {
            "filename": filename,
            "size": 3_554_031,
            "modified": time.time() - 3600,
            "slicer": "FakeSlicer",
            "slicer_version": "2.8.0",
            "layer_height": 0.2,
            "first_layer_height": 0.25,
            "object_height": 42.0,
            "layer_count": CONFIG.layers,
            "filament_total": 3600.0,
            "filament_weight_total": 11.2,
            "estimated_time": CONFIG.print_seconds,
            "gcode_start_byte": 40_000,
            "gcode_end_byte": 3_500_000,
            "thumbnails": [
                {"width": 300, "height": 300, "size": 4096, "relative_path": ".thumbs/preview.png"}
            ],
        }
    if method == "server.files.list":
        # A directory worth searching, so the Farm rail's file picker has
        # something to filter. Deterministic per instance rather than random:
        # a list that changes between calls makes a picker impossible to test.
        names = [
            CONFIG.filename,
            "gridfinity_bin_2x1.gcode",
            "gridfinity_bin_2x2.gcode",
            "bracket_left.gcode",
            "bracket_right.gcode",
            "spacer_x8.gcode",
            "calibration_cube.gcode",
            "benchy.gcode",
            "fan_duct_v4.gcode",
            "cable_clip.gcode",
            "hinge_a.gcode",
            "hinge_b.gcode",
            "case_lid.gcode",
            "case_base.gcode",
        ]
        now = time.time()
        return [
            {
                "path": name if index % 4 else f"projects/{name}",
                "modified": now - index * 3600,
                "size": 1_200_000 + index * 173_000,
                "permissions": "rw",
            }
            for index, name in enumerate(names)
        ]

    if method == "printer.print.pause":
        if machine.state == "printing":
            machine.elapsed_at_pause = machine.elapsed
            machine.state = "paused"
        return "ok"
    if method == "printer.print.resume":
        if machine.state == "paused":
            machine.started_at = time.monotonic()
            machine.state = "printing"
        return "ok"
    if method == "printer.print.cancel":
        machine.state = "cancelled"
        machine.elapsed_at_pause = machine.elapsed
        machine.hotend_target = 0.0
        machine.bed_target = 0.0
        return "ok"
    if method == "printer.print.start":
        machine.start_print(params.get("filename", CONFIG.filename))
        return "ok"
    if method == "printer.emergency_stop":
        machine.klippy_state = "shutdown"
        machine.state = "error"
        machine.hotend_target = 0.0
        machine.bed_target = 0.0
        asyncio.create_task(broadcast_notification("notify_klippy_shutdown", []))
        return "ok"
    if method in {"printer.firmware_restart", "printer.restart"}:
        machine.klippy_state = "ready"
        machine.state = "standby"
        asyncio.create_task(broadcast_notification("notify_klippy_ready", []))
        return "ok"
    if method == "printer.gcode.script":
        script = str(params.get("script", "")).upper()
        if "TURN_OFF_HEATERS" in script:
            machine.hotend_target = 0.0
            machine.bed_target = 0.0
        return "ok"

    if method == "machine.device_power.devices":
        if not CONFIG.has_power:
            raise KeyError(method)
        return {
            "devices": [
                {
                    "device": "printer",
                    "status": "on" if machine.power_on else "off",
                    "locked_while_printing": False,
                    "type": "gpio",
                }
            ]
        }
    if method == "machine.device_power.post_device":
        if not CONFIG.has_power:
            raise KeyError(method)
        machine.power_on = params.get("action") == "on"
        status = "on" if machine.power_on else "off"
        asyncio.create_task(
            broadcast_notification("notify_power_changed", [{"device": "printer", "status": status}])
        )
        return {"printer": status}

    if method == "server.spoolman.status":
        if not CONFIG.has_spoolman:
            raise KeyError(method)
        return {"spoolman_connected": True, "pending_reports": [], "spool_id": 1}
    if method == "server.spoolman.proxy":
        if not CONFIG.has_spoolman:
            raise KeyError(method)
        path = str(params.get("path", ""))
        if path.startswith("/v1/spool/"):
            return {"response": spool(), "error": None}
        if path == "/v1/spool":
            return {"response": [spool()], "error": None}
        return {"response": None, "error": {"message": "not simulated"}}

    if method == "machine.proc_stats":
        return {
            "moonraker_stats": [],
            "cpu_temp": 48.2,
            "system_cpu_usage": {"cpu": 12.0},
            "system_memory": {"total": 4_000_000, "available": 2_400_000},
        }
    if method == "machine.system_info":
        return {"system_info": {"cpu_info": {"cpu_desc": "Fake Pi", "total_memory": 4_000_000}}}
    if method == "server.database.get_item":
        raise KeyError(method)

    raise KeyError(method)


async def broadcast_notification(method: str, params: list[Any]) -> None:
    payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params})
    for socket in list(SUBSCRIBERS):
        if socket.closed:
            SUBSCRIBERS.pop(socket, None)
            continue
        try:
            await socket.send_str(payload)
        except ConnectionResetError:
            SUBSCRIBERS.pop(socket, None)


async def simulation_loop(_: web.Application) -> None:
    """Advances the machine and pushes what changed, at a real printer's cadence."""
    tick = 0
    previous_queue = json.dumps(MACHINE.queue)
    while True:
        await asyncio.sleep(0.5)
        advance(0.5)
        tick += 1

        for socket, objects in list(SUBSCRIBERS.items()):
            status = select(objects)
            # Temperatures every tick, everything else with them: a real printer
            # sends whatever changed, and here almost everything does.
            await broadcast_to(socket, "notify_status_update", [status, time.monotonic()])

        current_queue = json.dumps(MACHINE.queue)
        if current_queue != previous_queue:
            previous_queue = current_queue
            await broadcast_notification(
                "notify_job_queue_changed",
                [{"action": "state_changed", "updated_queue": MACHINE.queue, "queue_state": MACHINE.queue_state}],
            )

        # Moonraker pushes host telemetry at 1 Hz to every connection whether or
        # not anybody subscribed. Simulated because Alabaster's own measurements
        # of what a farm connection costs are dominated by it.
        if tick % 2 == 0:
            await broadcast_notification(
                "notify_proc_stat_update",
                [
                    {
                        "moonraker_stats": {
                            "time": time.time(),
                            "cpu_usage": round(random.uniform(1.0, 6.0), 2),
                            "memory": 48000,
                            "mem_units": "kB",
                        },
                        "cpu_temp": round(46 + random.uniform(-1, 1), 2),
                        "system_cpu_usage": {"cpu": round(random.uniform(4, 14), 2)},
                    }
                ],
            )


async def broadcast_to(socket: web.WebSocketResponse, method: str, params: list[Any]) -> None:
    if socket.closed:
        SUBSCRIBERS.pop(socket, None)
        return
    try:
        await socket.send_str(json.dumps({"jsonrpc": "2.0", "method": method, "params": params}))
    except ConnectionResetError:
        SUBSCRIBERS.pop(socket, None)


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------


def origin_allowed(origin: str | None) -> bool:
    if CONFIG.cors == "all":
        return True
    if CONFIG.cors == "none":
        return False
    allowed = {entry.strip() for entry in CONFIG.cors.split(",") if entry.strip()}
    return origin is not None and origin in allowed


async def websocket_handler(request: web.Request) -> web.StreamResponse:
    origin = request.headers.get("Origin")
    if not origin_allowed(origin):
        # Exactly what a real Moonraker does for an origin missing from
        # `cors_domains`: refuse the upgrade. The browser hides the status from
        # JavaScript, which is why Alabaster has to probe HTTP to tell this
        # apart from a printer that is switched off.
        return web.Response(status=403, text="origin not allowed")

    socket = web.WebSocketResponse(heartbeat=30)
    await socket.prepare(request)
    SUBSCRIBERS[socket] = None

    async for message in socket:
        if message.type is not WSMsgType.TEXT:
            continue
        try:
            payload = json.loads(message.data)
        except json.JSONDecodeError:
            continue

        request_id = payload.get("id")
        method = payload.get("method", "")
        params = payload.get("params") or {}
        if not isinstance(params, dict):
            params = {}

        if os.environ.get("LOG_RPC"):
            print(f"rpc {method}", flush=True)
        try:
            result = handle_rpc(method, params, socket)
        except KeyError:
            if request_id is not None:
                await socket.send_str(json.dumps(rpc_error(request_id, -32601, "Method not found")))
            continue
        except Exception as error:  # noqa: BLE001 - a simulator answers, never crashes
            if request_id is not None:
                await socket.send_str(json.dumps(rpc_error(request_id, -32603, str(error))))
            continue

        if request_id is not None:
            await socket.send_str(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}))

    SUBSCRIBERS.pop(socket, None)
    return socket


def cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*",
    }


async def http_server_info(_: web.Request) -> web.Response:
    """Also the target of Alabaster's reachability probe, which is what tells a
    refused origin apart from a printer that is switched off."""
    return web.json_response({"result": server_info()}, headers=cors_headers())


async def http_snapshot(_: web.Request) -> web.Response:
    if not CONFIG.has_camera:
        raise web.HTTPNotFound()
    return web.Response(body=render_frame(), content_type="image/jpeg", headers=cors_headers())


async def http_stream(request: web.Request) -> web.StreamResponse:
    if not CONFIG.has_camera:
        raise web.HTTPNotFound()
    boundary = "fakeframe"
    response = web.StreamResponse(
        headers={
            "Content-Type": f"multipart/x-mixed-replace; boundary={boundary}",
            "Cache-Control": "no-store",
            **cors_headers(),
        }
    )
    await response.prepare(request)
    try:
        while True:
            frame = render_frame()
            await response.write(
                b"--"
                + boundary.encode()
                + b"\r\nContent-Type: image/jpeg\r\nContent-Length: "
                + str(len(frame)).encode()
                + b"\r\n\r\n"
                + frame
                + b"\r\n"
            )
            await asyncio.sleep(0.2)
    except (ConnectionResetError, asyncio.CancelledError):
        pass
    return response


async def http_thumbnail(_: web.Request) -> web.Response:
    return web.Response(body=render_thumbnail(), content_type="image/png", headers=cors_headers())


async def http_root(_: web.Request) -> web.Response:
    return web.json_response(
        {
            "name": CONFIG.name,
            "scenario": CONFIG.scenario,
            "websocket": f"ws://<host>:{CONFIG.port}/websocket",
            "note": "Fake Moonraker for Alabaster development. Not a printer.",
        },
        headers=cors_headers(),
    )


def build_app() -> web.Application:
    app = web.Application()
    app.add_routes(
        [
            web.get("/", http_root),
            web.get("/websocket", websocket_handler),
            web.get("/server/info", http_server_info),
            web.get("/webcam/stream", http_stream),
            web.get("/webcam/snapshot", http_snapshot),
            # Whatever path the metadata's `relative_path` resolves to.
            web.get("/server/files/gcodes/{path:.*}", http_thumbnail),
        ]
    )

    async def start_simulation(application: web.Application) -> None:
        application["simulation"] = asyncio.create_task(simulation_loop(application))

    async def stop_simulation(application: web.Application) -> None:
        application["simulation"].cancel()

    app.on_startup.append(start_simulation)
    app.on_cleanup.append(stop_simulation)
    return app


if __name__ == "__main__":
    apply_scenario()
    print(
        f"fake Moonraker · {CONFIG.name} · scenario={CONFIG.scenario} · port={CONFIG.port} "
        f"· camera={'on' if CONFIG.has_camera else 'off'} · cors={CONFIG.cors}",
        flush=True,
    )
    web.run_app(build_app(), host="0.0.0.0", port=CONFIG.port, print=None)
