import {
  gcodeBoundsAreVisible,
  projectionFor,
  unprojectGcodeNdc,
  worldUnitsPerPixel,
  type GcodeProjection,
} from '@/features/gcode/camera'
import {
  gcodeCapStride,
  gcodeFeatureCount,
  gcodePathDetailStride,
  gcodeSeamLength,
  gcodeSegmentStride,
  type GcodeBounds,
  type GcodeCamera,
  type GcodeDecimationTier,
  type GcodeGeometryBatch,
  type GcodeGeometryTier,
  type GcodeRenderOptions,
  type GcodeRenderChunk,
  type ParsedGcodeGeometry,
  type ParsedGcodeSummary,
} from '@/features/gcode/types'
import { buildGcodeChunkSupergroups, type GcodeChunkSupergroup } from '@/features/gcode/lod'

/*
 * The projected bead width below which a surface stops holding together.
 *
 * Not one pixel, which is the intuitive answer and the wrong one. A solid
 * region's beads overlap, so their union is continuous and point sampling it
 * can never miss however small they get. What actually opens up is a region
 * that is *sparse* — infill — where the gaps are real, and closing those needs
 * beads several pixels wide, not merely one. Three is where the measured
 * color-boundary density on a 115 MB model stops falling appreciably.
 */
const subPixelBeadWidth = 3

/*
 * The projected bead width above which per-bead shading resolves on its own.
 * It is the same size at which the normal flattening starts, and for the same
 * reason: below it, a bead's orientation is detail smaller than the pixel
 * sampling it. Flattening averages that detail away; supersampling resolves it
 * instead, which is why the mode that pays for frames uses one and the mode
 * that saves them uses the other.
 */
const shadingResolvesAbove = 3

/*
 * Everything the bead body and its end caps must agree on, in one place. They
 * are separate programs with separate vertex layouts, so the parts that differ
 * (the pill's own point walk, the cap's quarter-turn sweep) stay local — but a
 * shading term that drifted between the two would show as a bright or dark
 * crease at every path end, which is exactly the kind of difference nobody
 * notices while editing one of two near-identical copies.
 */
const sharedShadingGlsl = `
const float PI = 3.141592653589793;

/*
 * How much of a bead's height goes into rounding its top corners.
 *
 * The textbook extrusion cross-section is a rectangle capped with semicircles,
 * which is a corner radius of half the layer height — and rendering that is
 * wrong, for a reason that is about pictures rather than about plastic. At 0.4 mm
 * wide and 0.2 mm tall it leaves a flat top only 0.248 mm across while the
 * slicer spaces its lines about 0.357 mm apart, so every bead gets a groove
 * roughly 0.11 mm wide and 0.1 mm deep down each side. On screen those grooves
 * are the dark seams between beads, they alias into diagonal streaks across any
 * surface at distance, and at a shallow viewing angle a sightline goes straight
 * down one and reaches the layer below — so an unfinished lower layer shows
 * through a finished top surface.
 *
 * On a real print the beads fuse and the valley fills in. A fraction this small
 * keeps a corner that still reads as rounded up close (a fifth of the bead's
 * height) while the flat tops of neighbouring beads meet and, with the overlap
 * scale applied, overlap — which is what makes two adjacent extrusions read as
 * one surface instead of two lines.
 */
const float BEAD_CORNER_HEIGHT_FRACTION = 0.2;

struct ProfilePoint {
  vec2 position;
  vec2 normal;
};

/*
 * Four cheap terms instead of one lamp. A single directional light left every
 * bead equally bright from every angle, which reads as flat however good the
 * geometry is: the hemisphere term separates tops from sides, and a fresnel
 * rim lifts the silhouette off the background. Deliberately still analytic —
 * no shadow map, no ambient occlusion — so this costs a few instructions.
 */
float graded_lighting(vec3 surface_normal) {
  vec3 key_direction = normalize(vec3(-0.45, -0.6, 1.0));
  float key = max(dot(surface_normal, key_direction), 0.0) * 0.55;
  float sky = surface_normal.z * 0.5 + 0.5;
  float hemisphere = mix(0.62, 1.0, sky) * 0.40;
  float rim = pow(1.0 - abs(surface_normal.z), 4.0) * 0.08;
  return min(1.35, key + hemisphere + rim);
}

/*
 * A rectangular bead: four corners, and a normal taken from the face rather
 * than from the point, so the faces stay flat with hard edges between them
 * instead of smooth-shading into one another the way an arc's points do.
 *
 * The top sits at y = 0 and the bottom at y = -height, matching pill_profile,
 * because the caller places the centerline at the top of the layer.
 */
ProfilePoint square_profile(int index, int face, float width, float height) {
  float half_width = max(0.01, width) * 0.5;
  float safe_height = max(0.01, height);
  int corner = index >= 4 ? index - 4 : index;
  vec2 position = corner == 0 ? vec2(half_width, 0.0)
    : corner == 1 ? vec2(half_width, -safe_height)
    : corner == 2 ? vec2(-half_width, -safe_height)
    : vec2(-half_width, 0.0);
  int wall = face >= 4 ? face - 4 : face;
  vec2 normal = wall == 0 ? vec2(1.0, 0.0)
    : wall == 1 ? vec2(0.0, -1.0)
    : wall == 2 ? vec2(-1.0, 0.0)
    : vec2(0.0, 1.0);
  return ProfilePoint(position, normal);
}

/*
 * Averages a normal that no longer fits inside a pixel.
 *
 * At a bead or two per pixel the surface normal is high-frequency detail
 * sampled once per fragment, and a model of it reads as a field of speckle
 * rather than as a solid object. The variation has two sources, and the
 * dominant one is not the obvious one. Within a bead the profile normal sweeps
 * from up to sideways — but the reduced profile is only six points, and its arc
 * lands exactly on the axes, so it carries no in-between normals to average.
 * What actually speckles is *which face of which bead* wins a sub-pixel depth
 * test: a top face and a side face of two neighbouring beads land in adjacent
 * pixels, and the two are lit very differently.
 *
 * So snapping each normal to its nearest axis does nothing whatsoever — that is
 * what the six-point profile already is, and measuring it confirmed byte-equal
 * output. Converging every normal on one shared direction is what removes the
 * variation, because then it stops mattering which face won.
 *
 * Measured on a 115 MB model at fitted zoom, as mean absolute difference in
 * luminance between adjacent surface pixels: 15.0 unflattened, 7.5 at the
 * ceiling this ships with, 0.05 fully converged. That last figure is a flat
 * silhouette with no form left at all, which is why normalFlattenFor keeps a
 * ceiling well below 1 — see there for how the number was chosen.
 */
vec2 flatten_profile_normal(vec2 profile_normal, float flatten) {
  return normalize(mix(profile_normal, vec2(0.0, 1.0), flatten));
}
`

const toolpathVertexShaderSource = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_start;
layout(location = 1) in vec3 a_end;
layout(location = 2) in vec4 a_meta;
layout(location = 3) in float a_extrusion_height;
layout(location = 4) in vec4 a_endpoint_offset;
layout(location = 5) in vec2 a_path_detail;
layout(location = 6) in float a_extrusion_width;
layout(location = 7) in vec2 a_path_width;
layout(location = 8) in float a_feature;
uniform mat4 u_view_projection;
uniform vec2 u_resolution;
uniform float u_travel_line_width;
uniform float u_extrusion_width;
// Widens every bead so neighbours overlap instead of leaving a hairline gap.
uniform float u_width_scale;
// 0 while a bead is wide enough to resolve its curvature, rising to 1 as it
// approaches pixel size. See normalFlattenFor for why this moves the normal
// rather than the light.
uniform float u_normal_flatten;
// 0 for the rounded pill, 1 for the four-faced square ribbon.
uniform float u_bead_profile;
uniform float u_profile_points;

out float v_layer;
out float v_kind;
out float v_progress;
out float v_lighting;
out float v_seam_distance;
out float v_seam_span;
out float v_feedrate;
flat out float v_seam_flags;
flat out float v_feature;
${sharedShadingGlsl}
ProfilePoint pill_profile(int index, int point_count, float width, float height) {
  float safe_width = max(0.01, width);
  float safe_height = max(0.01, height);
  float horizontal_radius = min(safe_width * 0.5, safe_height * BEAD_CORNER_HEIGHT_FRACTION);
  float vertical_radius = safe_height * 0.5;
  float straight_half = max(0.0, safe_width * 0.5 - horizontal_radius);
  int half_points = max(3, point_count / 2);
  int wrapped_index = index >= point_count ? 0 : index;
  bool right_arc = wrapped_index < half_points;
  float arc_index = right_arc ? float(wrapped_index) : float(wrapped_index - half_points);
  float arc_steps = float(half_points - 1);
  float angle = right_arc
    ? PI * 0.5 - arc_index * PI / arc_steps
    : -PI * 0.5 - arc_index * PI / arc_steps;
  float arc_center = right_arc ? straight_half : -straight_half;
  return ProfilePoint(
    vec2(arc_center + cos(angle) * horizontal_radius, -vertical_radius + sin(angle) * vertical_radius),
    normalize(vec2(cos(angle) / horizontal_radius, sin(angle) / vertical_radius))
  );
}

void main() {
  // Seam shading needs the extruded distance from the path ends, so every branch
  // reports where this vertex sits along the move and which ends are path ends.
  v_seam_span = length(a_end - a_start);
  v_seam_distance = 0.0;
  v_seam_flags = a_path_detail.y;
  v_feature = a_feature;
  v_feedrate = a_meta.z;
  vec4 start_clip = u_view_projection * vec4(a_start, 1.0);
  vec4 end_clip = u_view_projection * vec4(a_end, 1.0);
  vec2 start_ndc = start_clip.xy / max(0.0001, start_clip.w);
  vec2 end_ndc = end_clip.xy / max(0.0001, end_clip.w);
  vec2 delta_pixels = (end_ndc - start_ndc) * u_resolution * 0.5;
  vec2 direction = length(delta_pixels) > 0.001 ? normalize(delta_pixels) : vec2(1.0, 0.0);
  vec2 direction_xy = a_end.xy - a_start.xy;
  if (a_meta.y > 0.5 && length(direction_xy) > 0.0001) {
    vec2 world_normal = normalize(vec2(-direction_xy.y, direction_xy.x));
    int profile_points = int(u_profile_points + 0.5);
    int face = gl_VertexID / 6;
    int face_vertex = gl_VertexID - face * 6;
    /*
     * Corner order winds each quad counter-clockwise as seen from outside the
     * bead, which is what makes the outward faces the front faces and lets the
     * back faces — every one of which points into the bead's own interior — be
     * culled. Reversing this pair reverses that meaning, and the symptom is not
     * a blank screen: the tube's far inner wall is drawn instead of its near
     * outer wall, which still looks like a surface until you notice the shading
     * is inside out.
     */
    int corner = face_vertex == 0 ? 0
      : face_vertex == 1 ? 2
      : face_vertex == 2 ? 1
      : face_vertex == 3 ? 2
      : face_vertex == 4 ? 3
      : 1;
    float along = corner >= 2 ? 1.0 : 0.0;
    float across = (corner == 1 || corner == 3) ? 1.0 : 0.0;
    float layer_height = max(0.01, a_extrusion_height);
    // A move owns one width from start to finish. Its neighbour's direction and
    // extrusion volume must not taper or flare this segment at either endpoint.
    float extrusion_width =
      (a_path_width.x > 0.0 ? a_path_width.x : u_extrusion_width) * u_width_scale;
    int profile_index = face + int(across);
    // Assigned in branches rather than by ternary: the GLSL translator rejects
    // '?:' on a struct type, whatever the declared version says.
    ProfilePoint profile;
    if (u_bead_profile > 0.5) {
      profile = square_profile(profile_index, face, extrusion_width, layer_height);
    } else {
      profile = pill_profile(profile_index, profile_points, extrusion_width, layer_height);
    }
    vec3 centerline = mix(a_start, a_end, along);
    vec2 endpoint_offset = mix(a_endpoint_offset.xy, a_endpoint_offset.zw, along);
    vec3 position = centerline + vec3(endpoint_offset * profile.position.x, profile.position.y);
    vec2 shading_normal = flatten_profile_normal(profile.normal, u_normal_flatten);
    vec3 surface_normal = normalize(vec3(world_normal * shading_normal.x, shading_normal.y));

    gl_Position = u_view_projection * vec4(position, 1.0);
    v_lighting = graded_lighting(surface_normal);
    v_progress = mix(a_path_detail.x, a_meta.w, along);
    v_seam_distance = along * v_seam_span;
  } else {
    if (gl_VertexID >= 6 || a_meta.y > 0.5) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      v_lighting = 1.0;
      v_layer = a_meta.x;
      v_kind = a_meta.y;
      v_progress = a_meta.w;
      return;
    }
    int travel_corner = gl_VertexID == 0 ? 0
      : gl_VertexID == 1 ? 1
      : gl_VertexID == 2 ? 2
      : gl_VertexID == 3 ? 2
      : gl_VertexID == 4 ? 1
      : 3;
    bool at_end = travel_corner >= 2;
    float side = (travel_corner == 0 || travel_corner == 2) ? -1.0 : 1.0;
    vec2 normal_ndc = vec2(-direction.y, direction.x) * u_travel_line_width / u_resolution;
    vec4 base_clip = at_end ? end_clip : start_clip;
    base_clip.xy += normal_ndc * side * base_clip.w;
    gl_Position = base_clip;
    v_lighting = 1.0;
    v_progress = a_meta.w;
  }
  v_layer = a_meta.x;
  v_kind = a_meta.y;
}`

const capVertexShaderSource = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec2 a_direction;
layout(location = 2) in vec3 a_meta;
layout(location = 3) in float a_extrusion_width;

uniform mat4 u_view_projection;
uniform float u_extrusion_width;
// Widens every bead so neighbours overlap instead of leaving a hairline gap.
uniform float u_width_scale;
uniform float u_normal_flatten;
uniform float u_bead_profile;
uniform float u_profile_points;
// Sweep bands across the cap: three to turn a rounded tip, one to close a
// square bead with a single flat face.
uniform float u_cap_bands;

out float v_layer;
out float v_progress;
out float v_lighting;
${sharedShadingGlsl}
ProfilePoint pill_profile(int index, int point_count, float width, float height) {
  float safe_width = max(0.01, width);
  float safe_height = max(0.01, height);
  float horizontal_radius = min(safe_width * 0.5, safe_height * BEAD_CORNER_HEIGHT_FRACTION);
  float vertical_radius = safe_height * 0.5;
  float straight_half = max(0.0, safe_width * 0.5 - horizontal_radius);
  int arc_steps = max(2, point_count / 2 - 1);
  bool right_arc = index <= arc_steps;
  float arc_index = right_arc ? float(index) : float(index - arc_steps - 1);
  float angle = right_arc
    ? PI * 0.5 - arc_index * PI / float(arc_steps)
    : -PI * 0.5 - arc_index * PI / float(arc_steps);
  float arc_center = right_arc ? straight_half : -straight_half;
  return ProfilePoint(
    vec2(arc_center + cos(angle) * horizontal_radius, -vertical_radius + sin(angle) * vertical_radius),
    normalize(vec2(cos(angle) / horizontal_radius, sin(angle) / vertical_radius))
  );
}

void main() {
  int profile_points = int(u_profile_points + 0.5);
  int band = gl_VertexID / (profile_points * 6);
  int within_band = gl_VertexID - band * profile_points * 6;
  int facet = within_band / 6;
  int face_vertex = within_band - facet * 6;
  // Counter-clockwise from outside, matching the bead body it closes; see the
  // toolpath shader for what reversing this pair costs.
  int corner = face_vertex == 0 ? 0
    : face_vertex == 1 ? 2
    : face_vertex == 2 ? 1
    : face_vertex == 3 ? 2
    : face_vertex == 4 ? 3
    : 1;
  float along = corner >= 2 ? 1.0 : 0.0;
  float across = (corner == 1 || corner == 3) ? 1.0 : 0.0;
  int profile_index = facet + int(across);
  if (profile_index >= profile_points) profile_index = 0;

  float height = max(0.01, a_meta.z);
  float extrusion_width =
    (a_extrusion_width > 0.0 ? a_extrusion_width : u_extrusion_width) * u_width_scale;
  // Branches, not a ternary: '?:' is rejected on a struct type.
  ProfilePoint profile;
  if (u_bead_profile > 0.5) {
    profile = square_profile(profile_index, facet, extrusion_width, height);
  } else {
    profile = pill_profile(profile_index, profile_points, extrusion_width, height);
  }
  float cap_step = (float(band) + along) / max(1.0, u_cap_bands);
  float cap_angle = cap_step * PI * 0.5;
  /*
   * A round bead turns its tip over a quarter circle: the profile shrinks by
   * the cosine while the whole ring advances along the path by the sine. A
   * square bead has no tip to turn — it ends where it ends — so the profile
   * instead collapses straight to its own axis with no advance at all, which
   * fans the four corners into one flat face square across the path. Leaving
   * the tube open would show its inside wall at every path end, and a rounded
   * tip on a square bead is the mismatch that gets reported back.
   */
  float profile_scale = mix(cos(cap_angle), 1.0 - cap_step, u_bead_profile);
  float tangent_offset = mix(sin(cap_angle), 0.0, u_bead_profile) * extrusion_width * 0.5;
  vec2 normal_xy = vec2(-a_direction.y, a_direction.x);
  float centered_z = profile.position.y + height * 0.5;
  vec3 world_position = vec3(
    a_position.xy + a_direction * tangent_offset + normal_xy * profile.position.x * profile_scale,
    a_position.z - height * 0.5 + centered_z * profile_scale
  );
  vec2 shading_normal = flatten_profile_normal(profile.normal, u_normal_flatten);
  vec3 profile_normal = vec3(normal_xy * shading_normal.x, shading_normal.y);
  vec3 swept_normal = normalize(
    vec3(a_direction, 0.0) * sin(cap_angle) + profile_normal * cos(cap_angle)
  );
  // The flat face looks straight out along the path; a_direction already points
  // outward at both ends, negated for a start cap when it was emitted.
  vec3 surface_normal = normalize(mix(swept_normal, vec3(a_direction, 0.0), u_bead_profile));
  gl_Position = u_view_projection * vec4(world_position, 1.0);
  v_layer = a_meta.x;
  v_progress = a_meta.y;
  v_lighting = graded_lighting(surface_normal);
}`

const toolpathFragmentShaderSource = `#version 300 es
precision highp float;

uniform vec4 u_extrusion_color;
uniform vec4 u_travel_color;
uniform vec4 u_progress_color;
uniform vec4 u_seam_color;
uniform float u_layer_min;
uniform float u_layer_max;
/*
 * The band *this draw* may paint, which is not the same thing as the band the
 * user can see. A reduced tier draws everything below the active layer while
 * the full-resolution stream draws the active layer itself, so the two passes
 * have different pass bands and the same visible range. Deriving "is this the
 * active layer" from the pass band instead made the tier pass treat its own top
 * layer as active and paint it in the active color.
 */
uniform float u_pass_min;
uniform float u_pass_max;
uniform float u_show_travels;
uniform float u_print_progress;
uniform float u_reveal_current_layer;
uniform float u_highlight_seams;
uniform float u_seam_length;

in float v_layer;
in float v_kind;
in float v_progress;
in float v_lighting;
in float v_seam_distance;
in float v_seam_span;
in float v_feedrate;
flat in float v_seam_flags;
flat in float v_feature;
uniform int u_color_mode;
uniform vec4 u_feature_colors[8];
uniform vec4 u_feed_slow_color;
uniform vec4 u_feed_fast_color;
uniform vec2 u_feed_range;
out vec4 out_color;

// Only the ends the parser capped start or finish a continuous extrusion path;
// interior joins between moves are not seams.
float seam_strength() {
  if (u_highlight_seams < 0.5 || v_seam_span <= 0.0) return 0.0;
  bool has_start_cap = mod(floor(v_seam_flags), 2.0) >= 1.0;
  bool has_end_cap = mod(floor(v_seam_flags / 2.0), 2.0) >= 1.0;
  float from_start = has_start_cap ? v_seam_distance : u_seam_length;
  float from_end = has_end_cap ? v_seam_span - v_seam_distance : u_seam_length;
  float nearest_end = min(from_start, from_end);
  return 1.0 - smoothstep(0.0, u_seam_length, nearest_end);
}

/*
 * What an extrusion wears when nothing is overriding it. Feature and feed-rate
 * are *inspection* colors: they describe the file, so the follow-mode reveal
 * rules below still win over them.
 */
vec3 inspection_color() {
  if (u_color_mode == 1) {
    int index = int(v_feature + 0.5);
    return u_feature_colors[index < 0 || index > 7 ? 0 : index].rgb;
  }
  if (u_color_mode == 2) {
    float span = max(1.0, u_feed_range.y - u_feed_range.x);
    float ratio = clamp((v_feedrate - u_feed_range.x) / span, 0.0, 1.0);
    return mix(u_feed_slow_color.rgb, u_feed_fast_color.rgb, ratio);
  }
  return u_extrusion_color.rgb;
}

void main() {
  if (v_layer < u_pass_min - 0.5 || v_layer > u_pass_max + 0.5) discard;
  if (v_kind < 0.5 && u_show_travels < 0.5) discard;
  bool is_selected_layer = abs(v_layer - u_layer_max) < 0.5;
  bool has_print_progress = u_print_progress > 0.0;
  bool printed = has_print_progress && v_progress <= u_print_progress;
  if (v_kind < 0.5) {
    if (u_reveal_current_layer > 0.5 && is_selected_layer &&
        (!has_print_progress || v_progress > u_print_progress)) discard;
    out_color = vec4(u_travel_color.rgb, is_selected_layer ? 0.48 : 0.18);
  } else if (u_reveal_current_layer > 0.5) {
    if (is_selected_layer && (!has_print_progress || v_progress > u_print_progress)) discard;
    out_color = is_selected_layer
      ? vec4(u_extrusion_color.rgb, 1.0)
      : vec4(u_progress_color.rgb, 1.0);
  } else if (u_color_mode != 0 && has_print_progress) {
    /*
     * Simulation with an inspection color on: recoloring what is printed
     * would drown the very distinction the user turned on, so the reveal
     * inverts. Printed geometry keeps its feature or feed-rate color and
     * unprinted geometry drops to a faint shell — the frontier still reads,
     * and so does the mode.
     */
    out_color = printed
      ? vec4(inspection_color(), 1.0)
      : vec4(u_extrusion_color.rgb, 0.12);
  } else if (printed) {
    out_color = vec4(u_progress_color.rgb, 1.0);
  } else {
    out_color = vec4(inspection_color(), 1.0);
  }
  if (v_kind > 0.5) {
    // Mixed before shading so a seam is lit exactly like the tube it sits on.
    out_color.rgb = mix(out_color.rgb, u_seam_color.rgb, seam_strength());
    float layer_span = max(1.0, u_layer_max - u_layer_min);
    float layer_depth = clamp((v_layer - u_layer_min) / layer_span, 0.0, 1.0);
    float history_light = is_selected_layer ? 1.0 : mix(0.74, 0.94, layer_depth);
    out_color.rgb *= v_lighting * history_light;
  }
}`

const capFragmentShaderSource = `#version 300 es
precision highp float;

uniform vec4 u_extrusion_color;
uniform vec4 u_progress_color;
uniform vec4 u_seam_color;
uniform float u_layer_min;
uniform float u_layer_max;
/*
 * The band *this draw* may paint, which is not the same thing as the band the
 * user can see. A reduced tier draws everything below the active layer while
 * the full-resolution stream draws the active layer itself, so the two passes
 * have different pass bands and the same visible range. Deriving "is this the
 * active layer" from the pass band instead made the tier pass treat its own top
 * layer as active and paint it in the active color.
 */
uniform float u_pass_min;
uniform float u_pass_max;
uniform float u_print_progress;
uniform float u_reveal_current_layer;
uniform float u_highlight_seams;

in float v_layer;
in float v_progress;
in float v_lighting;
out vec4 out_color;

void main() {
  if (v_layer < u_pass_min - 0.5 || v_layer > u_pass_max + 0.5) discard;
  bool is_selected_layer = abs(v_layer - u_layer_max) < 0.5;
  bool has_print_progress = u_print_progress > 0.0;
  if (u_reveal_current_layer > 0.5) {
    if (is_selected_layer && (!has_print_progress || v_progress > u_print_progress)) discard;
    out_color = is_selected_layer
      ? vec4(u_extrusion_color.rgb, 1.0)
      : vec4(u_progress_color.rgb, 1.0);
  } else {
    out_color = has_print_progress && v_progress <= u_print_progress
      ? vec4(u_progress_color.rgb, 1.0)
      : vec4(u_extrusion_color.rgb, 1.0);
  }
  // Caps only exist where a path starts or ends, so every one of them is a seam.
  if (u_highlight_seams > 0.5) out_color.rgb = u_seam_color.rgb;
  float layer_span = max(1.0, u_layer_max - u_layer_min);
  float layer_depth = clamp((v_layer - u_layer_min) / layer_span, 0.0, 1.0);
  float history_light = is_selected_layer ? 1.0 : mix(0.74, 0.94, layer_depth);
  out_color.rgb *= v_lighting * history_light;
}`

const gridVertexShaderSource = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_position;
uniform mat4 u_view_projection;
void main() {
  gl_Position = u_view_projection * vec4(a_position, 1.0);
}`

const gridFragmentShaderSource = `#version 300 es
precision highp float;
uniform vec4 u_grid_color;
out vec4 out_color;
void main() {
  out_color = u_grid_color;
}`

const shadowVertexShaderSource = `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_start;
layout(location = 1) in vec3 a_end;
layout(location = 2) in vec4 a_meta;
layout(location = 4) in vec4 a_endpoint_offset;
layout(location = 5) in vec2 a_path_detail;
layout(location = 6) in float a_extrusion_width;

uniform mat4 u_view_projection;
uniform float u_extrusion_width;
// Widens every bead so neighbours overlap instead of leaving a hairline gap.
uniform float u_width_scale;
uniform float u_bed_z;

out float v_layer;
out float v_kind;
out float v_progress;

void main() {
  bool at_end = gl_VertexID >= 2;
  float side = (gl_VertexID == 0 || gl_VertexID == 2) ? -1.0 : 1.0;
  vec3 source = at_end ? a_end : a_start;
  vec2 endpoint_offset = at_end ? a_endpoint_offset.zw : a_endpoint_offset.xy;
  float height = max(0.0, source.z - u_bed_z);
  float extrusion_width =
    (a_extrusion_width > 0.0 ? a_extrusion_width : u_extrusion_width) * u_width_scale;
  vec2 cast_offset = vec2(-0.34, 0.46) * height;
  vec3 shadow_position = vec3(
    source.xy + cast_offset + endpoint_offset * extrusion_width * 0.68 * side,
    u_bed_z + 0.002
  );
  gl_Position = u_view_projection * vec4(shadow_position, 1.0);
  v_layer = a_meta.x;
  v_kind = a_meta.y;
  v_progress = at_end ? a_meta.w : a_path_detail.x;
}`

const shadowFragmentShaderSource = `#version 300 es
precision highp float;

uniform vec4 u_shadow_color;
uniform float u_layer_max;
/*
 * The band *this draw* may paint, which is not the same thing as the band the
 * user can see. A reduced tier draws everything below the active layer while
 * the full-resolution stream draws the active layer itself, so the two passes
 * have different pass bands and the same visible range. Deriving "is this the
 * active layer" from the pass band instead made the tier pass treat its own top
 * layer as active and paint it in the active color.
 */
uniform float u_pass_min;
uniform float u_pass_max;
uniform float u_print_progress;
uniform float u_reveal_current_layer;

in float v_layer;
in float v_kind;
in float v_progress;
out vec4 out_color;

void main() {
  if (v_kind < 0.5) discard;
  if (v_layer < u_pass_min - 0.5 || v_layer > u_pass_max + 0.5) discard;
  bool is_selected_layer = abs(v_layer - u_layer_max) < 0.5;
  bool has_print_progress = u_print_progress > 0.0;
  if (u_reveal_current_layer > 0.5 && is_selected_layer &&
      (!has_print_progress || v_progress > u_print_progress)) discard;
  out_color = u_shadow_color;
}`

const pickVertexShaderSource = `#version 300 es
precision highp float;
void main() {
  vec2 corners[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(corners[gl_VertexID], 0.0, 1.0);
}`

const pickFragmentShaderSource = `#version 300 es
precision highp float;
uniform highp sampler2D u_depth;
uniform vec2 u_resolution;
out vec4 out_color;
void main() {
  float depth = texture(u_depth, gl_FragCoord.xy / u_resolution).r;
  // Rounding the largest depth would land on 2^24, which a 32-bit float cannot
  // represent oddly enough to survive the byte split, so clamp it first.
  float scaled = min(floor(clamp(depth, 0.0, 1.0) * 16777215.0 + 0.5), 16777215.0);
  float high = floor(scaled / 65536.0);
  float middle = floor((scaled - high * 65536.0) / 256.0);
  float low = scaled - high * 65536.0 - middle * 256.0;
  out_color = vec4(high, middle, low, 255.0) / 255.0;
}`

export interface GcodeRenderColors {
  extrusion: readonly [number, number, number, number]
  travel: readonly [number, number, number, number]
  progress: readonly [number, number, number, number]
  seam: readonly [number, number, number, number]
  grid: readonly [number, number, number, number]
  shadow: readonly [number, number, number, number]
  originX: readonly [number, number, number, number]
  originY: readonly [number, number, number, number]
  origin: readonly [number, number, number, number]
  /** Indexed by GcodeFeature; index 0 is the unclassified fallback. */
  features: ReadonlyArray<readonly [number, number, number, number]>
  feedSlow: readonly [number, number, number, number]
  feedFast: readonly [number, number, number, number]
}

interface GcodePickResources {
  depthFramebuffer: WebGLFramebuffer
  depthTexture: WebGLTexture
  depthColorTexture: WebGLTexture
  resolveFramebuffer: WebGLFramebuffer
  resolveTexture: WebGLTexture
  program: WebGLProgram
  vertexArray: WebGLVertexArrayObject
}

// Odd size so one texel sits exactly on the pointer, with a few pixels of slack
// around it for aiming at thin walls.
const pickSize = 33
const pickCenter = (pickSize - 1) / 2
const pickColors: GcodeRenderColors = {
  extrusion: [0, 0, 0, 1],
  travel: [0, 0, 0, 1],
  progress: [0, 0, 0, 1],
  seam: [0, 0, 0, 1],
  grid: [0, 0, 0, 1],
  shadow: [0, 0, 0, 1],
  originX: [0, 0, 0, 1],
  originY: [0, 0, 0, 1],
  features: Array.from({ length: gcodeFeatureCount }, () => [0, 0, 0, 1] as const),
  feedSlow: [0, 0, 0, 1],
  feedFast: [0, 0, 0, 1],
  origin: [0, 0, 0, 1],
}

/**
 * The toolpath detail ladder. Every tier draws the same pill geometry with the
 * same shaders — what falls with distance is the vertex count per bead and
 * then the number of beads, never the kind of object on screen. That is the
 * whole difference from the voxel-column mode this replaced.
 */
type GcodeLod = 'full' | 'reduced' | 'decimated' | 'coarse'

/** One toolpath draw pass: which stream to read, and the layer band it covers. */
interface GcodeToolpathPass {
  vertexArray: WebGLVertexArrayObject
  segmentBuffer: WebGLBuffer
  pathDetailBuffer: WebGLBuffer
  ranges: Array<{ first: number; count: number }>
  layerMinimum: number
  layerMaximum: number
}

/** GPU residency for one reduced tier. */
interface LoadedTierStream {
  segmentBuffer: WebGLBuffer
  pathDetailBuffer: WebGLBuffer
  vertexArray: WebGLVertexArrayObject
  segmentCount: number
  chunks: GcodeRenderChunk[]
  supergroups: GcodeChunkSupergroup[]
}

function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const created = gl.createShader(type)
  if (!created) throw new Error('Unable to create WebGL shader')
  gl.shaderSource(created, source)
  gl.compileShader(created)
  if (!gl.getShaderParameter(created, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(created) ?? 'Unknown shader compilation error'
    gl.deleteShader(created)
    throw new Error(message)
  }
  return created
}

function program(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const created = gl.createProgram()
  if (!created) throw new Error('Unable to create WebGL program')
  const vertex = shader(gl, gl.VERTEX_SHADER, vertexSource)
  const fragment = shader(gl, gl.FRAGMENT_SHADER, fragmentSource)
  gl.attachShader(created, vertex)
  gl.attachShader(created, fragment)
  gl.linkProgram(created)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(created, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(created) ?? 'Unknown WebGL link error'
    gl.deleteProgram(created)
    throw new Error(message)
  }
  return created
}

function gridSpacing(bounds: GcodeBounds): number {
  const extent = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY)
  if (extent <= 120) return 5
  if (extent <= 350) return 10
  if (extent <= 700) return 25
  return 50
}

export function buildGcodeBedGrid(
  bounds: GcodeBounds,
  exactBounds: boolean,
): { vertices: Float32Array; bounds: GcodeBounds } {
  const spacing = gridSpacing(bounds)
  const minimumX = exactBounds
    ? bounds.minX
    : Math.floor((bounds.minX - spacing) / spacing) * spacing
  const maximumX = exactBounds
    ? bounds.maxX
    : Math.ceil((bounds.maxX + spacing) / spacing) * spacing
  const minimumY = exactBounds
    ? bounds.minY
    : Math.floor((bounds.minY - spacing) / spacing) * spacing
  const maximumY = exactBounds
    ? bounds.maxY
    : Math.ceil((bounds.maxY + spacing) / spacing) * spacing
  const z = bounds.minZ <= 0 && bounds.maxZ >= 0 ? 0 : bounds.minZ
  const values: number[] = []
  const xLines = new Set<number>([minimumX, maximumX])
  const yLines = new Set<number>([minimumY, maximumY])

  for (let x = Math.ceil(minimumX / spacing) * spacing; x <= maximumX; x += spacing) {
    xLines.add(x)
  }
  for (let y = Math.ceil(minimumY / spacing) * spacing; y <= maximumY; y += spacing) {
    yLines.add(y)
  }
  for (const x of [...xLines].sort((a, b) => a - b)) {
    values.push(x, minimumY, z, x, maximumY, z)
  }
  for (const y of [...yLines].sort((a, b) => a - b)) {
    values.push(minimumX, y, z, maximumX, y, z)
  }

  return {
    vertices: new Float32Array(values),
    bounds: {
      minX: Math.min(minimumX, bounds.minX),
      maxX: Math.max(maximumX, bounds.maxX),
      minY: Math.min(minimumY, bounds.minY),
      maxY: Math.max(maximumY, bounds.maxY),
      minZ: z,
      maxZ: z + 1,
    },
  }
}

export interface GcodeBedOriginGeometry {
  vertices: Float32Array
  axisVertexCount: number
  dotVertexCount: number
}

// The origin marker is world geometry rather than an overlay drawing, so the
// print occludes it and it cannot streak across the screen when the origin falls
// behind the camera. Flat strips on the bed keep it legible at any zoom.
export function buildGcodeBedOrigin(bed: GcodeBounds): GcodeBedOriginGeometry {
  const originX = bed.minX <= 0 && bed.maxX >= 0 ? 0 : bed.minX
  const originY = bed.minY <= 0 && bed.maxY >= 0 ? 0 : bed.minY
  const span = Math.max(1, Math.min(bed.maxX - bed.minX, bed.maxY - bed.minY) * 0.075)
  const halfWidth = Math.max(0.12, span * 0.04)
  const dotRadius = Math.max(0.2, span * 0.1)
  // Clears the grid lines and the cast shadows, both of which sit on the bed.
  const z = bed.minZ + 0.006
  const values: number[] = []
  const strip = (spanX: number, spanY: number, offsetX: number, offsetY: number): void => {
    const corners: Array<[number, number]> = [
      [originX - offsetX, originY - offsetY],
      [originX + spanX - offsetX, originY + spanY - offsetY],
      [originX + spanX + offsetX, originY + spanY + offsetY],
      [originX + offsetX, originY + offsetY],
    ]
    for (const index of [0, 1, 2, 0, 2, 3]) {
      const corner = corners[index] ?? [originX, originY]
      values.push(corner[0], corner[1], z)
    }
  }

  strip(span, 0, 0, halfWidth)
  strip(0, span, halfWidth, 0)

  const dotFacets = 8
  for (let facet = 0; facet < dotFacets; facet += 1) {
    const from = (facet / dotFacets) * Math.PI * 2
    const to = ((facet + 1) / dotFacets) * Math.PI * 2
    values.push(
      originX,
      originY,
      z,
      originX + Math.cos(from) * dotRadius,
      originY + Math.sin(from) * dotRadius,
      z,
      originX + Math.cos(to) * dotRadius,
      originY + Math.sin(to) * dotRadius,
      z,
    )
  }

  return {
    vertices: new Float32Array(values),
    axisVertexCount: 6,
    dotVertexCount: dotFacets * 3,
  }
}

function unionBounds(a: GcodeBounds, b: GcodeBounds): GcodeBounds {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
    minZ: Math.min(a.minZ, b.minZ),
    maxZ: Math.max(a.maxZ, b.maxZ),
  }
}

export class GcodeRenderer {
  private readonly gl: WebGL2RenderingContext
  private readonly toolpathProgram: WebGLProgram
  private readonly capProgram: WebGLProgram
  private readonly gridProgram: WebGLProgram
  private readonly shadowProgram: WebGLProgram
  // Replaced when a streamed load outgrows their capacity; every draw rebinds
  // attribute pointers, so a replacement is picked up on the next frame.
  private toolpathBuffer: WebGLBuffer
  private pathDetailBuffer: WebGLBuffer
  private capBuffer: WebGLBuffer
  private readonly gridBuffer: WebGLBuffer
  private readonly originBuffer: WebGLBuffer
  private readonly toolpathVertexArray: WebGLVertexArrayObject
  private readonly capVertexArray: WebGLVertexArrayObject
  private readonly gridVertexArray: WebGLVertexArrayObject
  private readonly originVertexArray: WebGLVertexArrayObject
  private readonly uniformLocations = new Map<string, WebGLUniformLocation>()
  // Looked up once, missing, and not asked for again every frame.
  private readonly absentUniforms = new Set<string>()
  private segmentCount = 0
  private capCount = 0
  private layerHeights: Float32Array<ArrayBufferLike> = new Float32Array([1])
  private renderChunks: GcodeRenderChunk[] = []
  private capRenderChunks: GcodeRenderChunk[] = []
  private supergroups: GcodeChunkSupergroup[] = []
  private capSupergroups: GcodeChunkSupergroup[] = []
  private tierStreams = new Map<GcodeDecimationTier, LoadedTierStream>()
  private gridVertexCount = 0
  private originAxisVertexCount = 0
  private originDotVertexCount = 0
  private modelBounds: GcodeBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
  private bed: GcodeBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
  private bounds: GcodeBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
  private explicitBed: GcodeBounds | undefined
  // Multiplies the progress uniform so it compares against buffer values that
  // were normalized by the download's expected size (see ParsedGcodeSummary).
  private progressScale = 1
  private readonly toolpathStream = { capacity: 0, used: 0 }
  private readonly pathDetailStream = { capacity: 0, used: 0 }
  private readonly capStream = { capacity: 0, used: 0 }
  private width = 1
  private height = 1
  private pixelRatio = 1
  /** Extra samples per screen pixel actually in force; 1 when not supersampling. */
  private sampleScale = 1
  private pickResources: GcodePickResources | null = null
  private pickUnavailable = false
  private readonly pickPixels = new Uint8Array(pickSize * pickSize * 4)
  // The scene's matrix outlives its frame: the view keeps the returned
  // projection to place the nozzle overlay at full frame rate while the scene
  // itself renders at 20 fps. The pick pass therefore gets its own storage
  // rather than sharing a scratch that would rewrite the overlay's projection.
  private readonly diagnostics = { lod: 'none', instances: 0, drawCalls: 0 }
  private readonly sceneMatrix = new Float32Array(16)
  private readonly pickMatrix = new Float32Array(16)

  constructor(private readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    })
    if (!gl) throw new Error('WebGL 2 is not available')
    this.gl = gl
    this.toolpathProgram = program(gl, toolpathVertexShaderSource, toolpathFragmentShaderSource)
    this.capProgram = program(gl, capVertexShaderSource, capFragmentShaderSource)
    this.gridProgram = program(gl, gridVertexShaderSource, gridFragmentShaderSource)
    this.shadowProgram = program(gl, shadowVertexShaderSource, shadowFragmentShaderSource)
    const toolpathBuffer = gl.createBuffer()
    const pathDetailBuffer = gl.createBuffer()
    const capBuffer = gl.createBuffer()
    const gridBuffer = gl.createBuffer()
    const originBuffer = gl.createBuffer()
    const toolpathVertexArray = gl.createVertexArray()
    const capVertexArray = gl.createVertexArray()
    const gridVertexArray = gl.createVertexArray()
    const originVertexArray = gl.createVertexArray()
    if (
      !toolpathBuffer ||
      !pathDetailBuffer ||
      !capBuffer ||
      !gridBuffer ||
      !originBuffer ||
      !toolpathVertexArray ||
      !capVertexArray ||
      !gridVertexArray ||
      !originVertexArray
    ) {
      throw new Error('Unable to allocate WebGL geometry')
    }
    this.toolpathBuffer = toolpathBuffer
    this.pathDetailBuffer = pathDetailBuffer
    this.capBuffer = capBuffer
    this.gridBuffer = gridBuffer
    this.originBuffer = originBuffer
    this.toolpathVertexArray = toolpathVertexArray
    this.capVertexArray = capVertexArray
    this.gridVertexArray = gridVertexArray
    this.originVertexArray = originVertexArray

    this.bindToolpathAttributes(toolpathVertexArray, toolpathBuffer, pathDetailBuffer)

    gl.bindVertexArray(capVertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, capBuffer)
    const capStride = gcodeCapStride * Float32Array.BYTES_PER_ELEMENT
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, capStride, 0)
    gl.vertexAttribDivisor(0, 1)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, capStride, 3 * Float32Array.BYTES_PER_ELEMENT)
    gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, capStride, 5 * Float32Array.BYTES_PER_ELEMENT)
    gl.vertexAttribDivisor(2, 1)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, capStride, 8 * Float32Array.BYTES_PER_ELEMENT)
    gl.vertexAttribDivisor(3, 1)

    gl.bindVertexArray(gridVertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, gridBuffer)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(originVertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, originBuffer)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)

    gl.bindVertexArray(null)

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LEQUAL)
  }

  load(geometry: ParsedGcodeGeometry, bedBounds?: GcodeBounds): void {
    this.segmentCount = geometry.segmentCount
    this.capCount = geometry.capCount
    this.layerHeights = geometry.layerHeights
    this.renderChunks = geometry.renderChunks
    this.capRenderChunks = geometry.capRenderChunks
    this.supergroups = buildGcodeChunkSupergroups(geometry.renderChunks)
    this.capSupergroups = buildGcodeChunkSupergroups(geometry.capRenderChunks)
    this.uploadTiers(geometry.tiers)
    this.modelBounds = geometry.bounds
    this.progressScale = 1
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.toolpathBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, geometry.segments, this.gl.STATIC_DRAW)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.pathDetailBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, geometry.pathDetails, this.gl.STATIC_DRAW)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.capBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, geometry.caps, this.gl.STATIC_DRAW)
    this.toolpathStream.capacity = geometry.segments.byteLength
    this.toolpathStream.used = geometry.segments.byteLength
    this.pathDetailStream.capacity = geometry.pathDetails.byteLength
    this.pathDetailStream.used = geometry.pathDetails.byteLength
    this.capStream.capacity = geometry.caps.byteLength
    this.capStream.used = geometry.caps.byteLength
    this.setBedBounds(bedBounds)
  }

  /**
   * Starts a streamed load: the scene empties and then grows batch by batch
   * through appendGeometryBatch, so a large file becomes visible while it is
   * still downloading and parsing. Buffer capacity is kept from the previous
   * load — reloading a similar file reuses its allocations.
   */
  beginStreamedLoad(bedBounds?: GcodeBounds): void {
    this.segmentCount = 0
    this.capCount = 0
    this.renderChunks = []
    this.capRenderChunks = []
    this.supergroups = []
    this.capSupergroups = []
    this.releaseTiers()
    this.layerHeights = new Float32Array([1])
    this.progressScale = 1
    this.toolpathStream.used = 0
    this.pathDetailStream.used = 0
    this.capStream.used = 0
    this.modelBounds = { minX: 0, maxX: 1, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }
    this.setBedBounds(bedBounds)
  }

  appendGeometryBatch(batch: GcodeGeometryBatch): void {
    this.appendStreamed('toolpathBuffer', this.toolpathStream, batch.segments)
    this.appendStreamed('pathDetailBuffer', this.pathDetailStream, batch.pathDetails)
    if (batch.caps.length > 0) this.appendStreamed('capBuffer', this.capStream, batch.caps)
    this.renderChunks.push(...batch.renderChunks)
    this.capRenderChunks.push(...batch.capRenderChunks)
    // Rebuilt rather than appended: a supergroup covers a fixed chunk count, so
    // the last one of a batch may still have room for the next batch's chunks.
    this.supergroups = buildGcodeChunkSupergroups(this.renderChunks)
    this.capSupergroups = buildGcodeChunkSupergroups(this.capRenderChunks)
    this.segmentCount += batch.segmentCount
    this.capCount += batch.capCount
    this.modelBounds = { ...batch.bounds }
    // With a configured bed the grid is already final; without one it tracks
    // the growing model so early batches are not drawn on a unit-sized floor.
    if (this.explicitBed) this.bounds = unionBounds(this.modelBounds, this.bed)
    else this.setBedBounds(undefined)
  }

  finishStreamedLoad(summary: ParsedGcodeSummary): void {
    this.layerHeights = summary.layerHeights
    this.progressScale = summary.progressScale
    this.modelBounds = summary.bounds
    this.uploadTiers(summary.tiers)
    this.setBedBounds(this.explicitBed)
  }

  /**
   * The toolpath instance layout, shared by the full stream and every reduced
   * tier. One definition means a tier can never drift into reading a field
   * from the wrong offset.
   */
  private bindToolpathAttributes(
    vertexArray: WebGLVertexArrayObject,
    segmentBuffer: WebGLBuffer,
    pathDetailBuffer: WebGLBuffer,
  ): void {
    const gl = this.gl
    const floatSize = Float32Array.BYTES_PER_ELEMENT
    gl.bindVertexArray(vertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, segmentBuffer)
    const stride = gcodeSegmentStride * floatSize
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0)
    gl.vertexAttribDivisor(0, 1)
    gl.enableVertexAttribArray(1)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * floatSize)
    gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, stride, 6 * floatSize)
    gl.vertexAttribDivisor(2, 1)
    gl.enableVertexAttribArray(3)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 10 * floatSize)
    gl.vertexAttribDivisor(3, 1)
    gl.enableVertexAttribArray(6)
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, stride, 11 * floatSize)
    gl.vertexAttribDivisor(6, 1)
    gl.enableVertexAttribArray(8)
    gl.vertexAttribPointer(8, 1, gl.FLOAT, false, stride, 12 * floatSize)
    gl.vertexAttribDivisor(8, 1)

    gl.bindBuffer(gl.ARRAY_BUFFER, pathDetailBuffer)
    const pathDetailStride = gcodePathDetailStride * floatSize
    gl.enableVertexAttribArray(4)
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, pathDetailStride, 0)
    gl.vertexAttribDivisor(4, 1)
    gl.enableVertexAttribArray(5)
    gl.vertexAttribPointer(5, 2, gl.FLOAT, false, pathDetailStride, 4 * floatSize)
    gl.vertexAttribDivisor(5, 1)
    gl.enableVertexAttribArray(7)
    gl.vertexAttribPointer(7, 2, gl.FLOAT, false, pathDetailStride, 6 * floatSize)
    gl.vertexAttribDivisor(7, 1)
    gl.bindVertexArray(null)
  }

  private uploadTiers(tiers: Record<GcodeDecimationTier, GcodeGeometryTier>): void {
    const gl = this.gl
    this.releaseTiers()
    for (const [name, tier] of Object.entries(tiers) as Array<
      [GcodeDecimationTier, GcodeGeometryTier]
    >) {
      if (tier.segmentCount <= 0) continue
      const segmentBuffer = gl.createBuffer()
      const pathDetailBuffer = gl.createBuffer()
      const vertexArray = gl.createVertexArray()
      if (!segmentBuffer || !pathDetailBuffer || !vertexArray) {
        throw new Error('Unable to allocate WebGL geometry')
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, segmentBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, tier.segments, gl.STATIC_DRAW)
      gl.bindBuffer(gl.ARRAY_BUFFER, pathDetailBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, tier.pathDetails, gl.STATIC_DRAW)
      this.bindToolpathAttributes(vertexArray, segmentBuffer, pathDetailBuffer)
      this.tierStreams.set(name, {
        segmentBuffer,
        pathDetailBuffer,
        vertexArray,
        segmentCount: tier.segmentCount,
        chunks: tier.renderChunks,
        supergroups: buildGcodeChunkSupergroups(tier.renderChunks),
      })
    }
  }

  private releaseTiers(): void {
    for (const stream of this.tierStreams.values()) {
      this.gl.deleteBuffer(stream.segmentBuffer)
      this.gl.deleteBuffer(stream.pathDetailBuffer)
      this.gl.deleteVertexArray(stream.vertexArray)
    }
    this.tierStreams.clear()
  }

  private appendStreamed(
    bufferName: 'toolpathBuffer' | 'pathDetailBuffer' | 'capBuffer',
    stream: { capacity: number; used: number },
    data: Float32Array,
  ): void {
    const gl = this.gl
    const needed = stream.used + data.byteLength
    if (needed > stream.capacity) {
      // Double rather than fit: per-batch reallocations of a 100 MB stream
      // would copy the whole buffer dozens of times. The copy is GPU-to-GPU.
      const capacity = Math.max(needed, stream.capacity * 2, 1 << 22)
      const grown = gl.createBuffer()
      if (!grown) throw new Error('Unable to allocate WebGL geometry')
      gl.bindVertexArray(null)
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, grown)
      gl.bufferData(gl.COPY_WRITE_BUFFER, capacity, gl.STATIC_DRAW)
      if (stream.used > 0) {
        gl.bindBuffer(gl.COPY_READ_BUFFER, this[bufferName])
        gl.copyBufferSubData(gl.COPY_READ_BUFFER, gl.COPY_WRITE_BUFFER, 0, 0, stream.used)
        gl.bindBuffer(gl.COPY_READ_BUFFER, null)
      }
      gl.bindBuffer(gl.COPY_WRITE_BUFFER, null)
      gl.deleteBuffer(this[bufferName])
      this[bufferName] = grown
      stream.capacity = capacity
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this[bufferName])
    gl.bufferSubData(gl.ARRAY_BUFFER, stream.used, data)
    stream.used = needed
  }

  setBedBounds(bedBounds?: GcodeBounds): void {
    this.explicitBed = bedBounds
    const grid = buildGcodeBedGrid(bedBounds ?? this.modelBounds, Boolean(bedBounds))
    this.bed = grid.bounds
    this.bounds = unionBounds(this.modelBounds, grid.bounds)
    this.gridVertexCount = grid.vertices.length / 3
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.gridBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, grid.vertices, this.gl.STATIC_DRAW)

    const origin = buildGcodeBedOrigin(this.bed)
    this.originAxisVertexCount = origin.axisVertexCount
    this.originDotVertexCount = origin.dotVertexCount
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.originBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, origin.vertices, this.gl.STATIC_DRAW)
  }

  /**
   * Development diagnostics for the last *rendered* frame. Scene rendering is
   * deferred to a frame callback, so reading this straight after an input event
   * reports the frame before it.
   */
  lastFrameDiagnostics(): { lod: string; instances: number; drawCalls: number } {
    return { ...this.diagnostics }
  }

  sceneBounds(): GcodeBounds {
    return { ...this.bounds }
  }

  bedBounds(): GcodeBounds {
    return { ...this.bed }
  }

  /**
   * `sampleScale` is extra samples per screen pixel, kept separate from
   * `pixelRatio` rather than folded into it by the caller.
   *
   * The two mean different things and only one of them may reach the tier
   * ladder. A device pixel ratio says how finely the screen shows the picture,
   * so a bead really is bigger on a dense display and may earn finer geometry.
   * Supersampling says only that the same picture is being sampled better, and
   * letting that argue for finer geometry costs twice over — more fragments and
   * more instances — which measured as 74 fps falling to 31 rather than the cost
   * of the extra fragments alone.
   */
  resize(
    width: number,
    height: number,
    pixelRatio: number,
    maximumRatio = 2,
    sampleScale = 1,
  ): void {
    this.width = Math.max(1, width)
    this.height = Math.max(1, height)
    const base = Math.min(maximumRatio, Math.max(0.5, pixelRatio))
    // How much extra sampling survived the governor's cap, which may be none.
    this.sampleScale = Math.max(
      1,
      Math.min(maximumRatio, Math.max(0.5, pixelRatio * Math.max(1, sampleScale))) / base,
    )
    pixelRatio *= Math.max(1, sampleScale)
    // The lower bound is deliberately below 1: dropping under one device pixel
    // per CSS pixel is the last, largest saving available before geometry has
    // to go, and it costs only softness.
    this.pixelRatio = Math.min(maximumRatio, Math.max(0.5, pixelRatio))
    const deviceWidth = Math.round(this.width * this.pixelRatio)
    const deviceHeight = Math.round(this.height * this.pixelRatio)
    if (this.canvas.width !== deviceWidth) this.canvas.width = deviceWidth
    if (this.canvas.height !== deviceHeight) this.canvas.height = deviceHeight
    this.gl.viewport(0, 0, deviceWidth, deviceHeight)
  }

  private pixelsForWorldDistance(camera: GcodeCamera, distance: number): number {
    const worldPerPixel = worldUnitsPerPixel(camera, this.height)
    return (Math.max(0.01, distance) * this.pixelRatio) / Math.max(0.0001, worldPerPixel)
  }

  /** Projected width of one bead, in device pixels, at the camera's distance. */
  private beadPixels(camera: GcodeCamera, options: GcodeRenderOptions): number {
    return this.pixelsForWorldDistance(
      camera,
      options.extrusionWidth * Math.max(0.5, options.widthScale),
    )
  }

  /**
   * Samples per screen pixel this frame would like, as a multiplier on the
   * device pixel ratio.
   *
   * The multisampling the context already asks for resolves *coverage* per
   * sample but runs the fragment shader once per pixel, so it anti-aliases a
   * bead's silhouette and leaves its shading alone. Shading is the half that
   * aliases here: each bead is lit from its own orientation, and once beads
   * approach pixel size that orientation is high-frequency detail being point
   * sampled, which is the speckle. Rendering into more pixels and letting them
   * be averaged down runs the shader per sub-sample, which is the only thing
   * that touches it — measured on a 115 MB model, adjacent-pixel variation
   * 15.0 to 7.2.
   *
   * Thresholds are expressed at the base scale, dividing out whatever is
   * currently applied. Without that the measurement moves with the decision:
   * supersampling doubles a bead's pixel size, which would immediately argue
   * for switching it back off. The two are far apart as well, because acting on
   * this reallocates the drawing buffer, and a single threshold would thrash it
   * every time a bead hovered near the line while the user zoomed.
   *
   * The result is only a request. `resize` clamps it to the governor's own
   * resolution cap, so a machine that cannot afford this loses it in the normal
   * course of degrading rather than through a special case here.
   */
  desiredSampleScale(camera: GcodeCamera, options: GcodeRenderOptions, current = 1): number {
    if (options.subPixelStrategy !== 'preserve') return 1
    const applied = Math.max(0.5, current)
    const pixelsAtBaseScale = this.beadPixels(camera, options) / applied
    if (applied > 1) return pixelsAtBaseScale > shadingResolvesAbove * 1.5 ? 1 : 2
    return pixelsAtBaseScale < shadingResolvesAbove ? 2 : 1
  }

  /**
   * The bead overlap to draw with, widened where beads have fallen below a pixel
   * so a surface made of them closes up again.
   *
   * Point sampling a sub-pixel bead is a lottery: it takes a pixel's center or
   * it misses, so a surface is drawn with holes it does not have and the layer
   * below shows through them. Growing the bead until it spans a pixel restores
   * the coverage — and the amount it grows by is itself sub-pixel, so nothing
   * about the picture changes except that it stops leaking.
   *
   * What this does cost is truth: where the surface above really is sparse, its
   * genuine gaps close too, and the infill under it stops being readable. That
   * is a trade the Performance mode makes deliberately and the Quality mode
   * refuses — see `gcodeSubPixelStrategyFor`.
   *
   * The ceiling stops a model that has shrunk to a handful of pixels from
   * inflating into a blob. By then the surface has long since closed.
   */
  private closedSurfaceWidthScale(camera: GcodeCamera, options: GcodeRenderOptions): number {
    const requested = Math.max(0.5, options.widthScale)
    if (options.subPixelStrategy !== 'widen') return requested
    const pixels = this.beadPixels(camera, options)
    if (pixels >= subPixelBeadWidth) return requested
    const widened = (requested * subPixelBeadWidth) / Math.max(0.02, pixels)
    return Math.min(requested * 4, widened)
  }

  private layerHeightFor(selectedLayer: number): number {
    const index = Math.min(this.layerHeights.length - 1, Math.max(0, selectedLayer))
    const current = this.layerHeights[index] ?? 0
    const previous = index > 0 ? (this.layerHeights[index - 1] ?? 0) : 0
    const selectedHeight = current - previous
    if (selectedHeight > 0.001) return selectedHeight
    for (let layer = index; layer > 0; layer -= 1) {
      const height = (this.layerHeights[layer] ?? 0) - (this.layerHeights[layer - 1] ?? 0)
      if (height > 0.001) return height
    }
    return Math.max(0.01, current)
  }

  // Progress arrives normalized by the actual byte total; streamed GPU buffers
  // were normalized by the expected total. The scale maps one onto the other,
  // so no clamp at 1: buffer values can pass 1 when a download lied about its
  // size, and clamping would freeze the reveal short of the file's tail.
  private scaledProgress(options: GcodeRenderOptions): number {
    return Math.max(0, options.printProgress) * this.progressScale
  }

  /**
   * Detail is chosen from how many pixels one bead covers, and from nothing
   * else. Notably absent are the travel and seam conditions the old surface
   * mode needed: those toggles used to disable the far LOD outright, which
   * made the two settings a user is most likely to enable the two that made a
   * large file slow, with nothing on screen explaining why.
   */
  private lodFor(camera: GcodeCamera, options: GcodeRenderOptions): GcodeLod {
    // A fitted view of a bed-sized model puts a 0.4 mm bead at roughly 1.3
    // pixels, so the reduced tiers have to engage above one pixel to do any
    // work at all on the view the user spends most of their time in. The
    // governor's bias scales the apparent size, engaging tiers sooner on a
    // machine that has been measured to need it.
    const bias = Math.max(0.1, options.tierBias)
    // Divided by the sample scale so supersampling cannot talk the ladder into
    // drawing more geometry; it samples the same picture, it does not enlarge it.
    const extrusionPixels =
      this.pixelsForWorldDistance(camera, options.extrusionWidth) / bias / this.sampleScale
    if (extrusionPixels < 0.7 && this.tierStreams.has('coarse')) return 'coarse'
    if (extrusionPixels < 1.5 && this.tierStreams.has('decimated')) return 'decimated'
    return extrusionPixels < 3 ? 'reduced' : 'full'
  }

  /**
   * Points around a bead's cross-section: four for a square ribbon, and for a
   * pill 14 at full detail or 6 below it.
   */
  private profilePointsFor(lod: GcodeLod, options: GcodeRenderOptions): number {
    if (options.beadProfile === 'square') return 4
    return lod === 'full' ? 14 : 6
  }

  /**
   * How far to turn bead normals toward one shared upward normal, from 0 (each
   * bead lit from its own orientation) to the ceiling below.
   *
   * Every bead is lit from its own orientation, and a real toolpath wanders, so
   * neighbouring beads differ slightly in brightness. Close up that reads as the
   * surface texture of a print, which is exactly right. Once beads reach pixel
   * size it is high-frequency detail sampled once per pixel, and the model reads
   * as speckle rather than as a solid object — see flatten_profile_normal for
   * what the speckle actually is, which is not what it looks like.
   *
   * Two things this must not become. It must not fade the *lit result* toward a
   * constant, which is what an earlier attempt did: that removed the speckle by
   * removing the shading with it, and lifted everything toward white. And it
   * must not converge all the way, which removes the same shading by a
   * different route — measured, a fully converged model is one flat tone whose
   * only remaining shape cue is its silhouette.
   *
   * The ceiling is therefore the whole design. At 0.6 the measured pixel-to-
   * pixel variation drops by half — matching what 2x supersampling achieves on
   * the same frame, for none of its cost — while enough orientation survives
   * that sculpted detail still reads. Raising it flattens the model; lowering it
   * gives the speckle back.
   */
  private normalFlattenFor(camera: GcodeCamera, options: GcodeRenderOptions): number {
    const pixels = this.pixelsForWorldDistance(camera, options.extrusionWidth)
    // Above `beadResolves` a bead is wide enough to be lit on its own terms; at
    // `beadSubPixel` and below there is no longer a pixel to light it in.
    const beadResolves = 3
    const beadSubPixel = 1.2
    const maximumFlatten = 0.6
    const ratio = (beadResolves - pixels) / (beadResolves - beadSubPixel)
    return maximumFlatten * Math.min(1, Math.max(0, ratio))
  }

  render(
    camera: GcodeCamera,
    options: GcodeRenderOptions,
    colors: GcodeRenderColors,
  ): GcodeProjection {
    const gl = this.gl
    const projection = projectionFor(this.bounds, camera, this.width, this.height, this.sceneMatrix)
    const lod = this.lodFor(camera, options)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

    if (this.gridVertexCount > 0) {
      gl.useProgram(this.gridProgram)
      gl.bindVertexArray(this.gridVertexArray)
      gl.uniformMatrix4fv(
        this.location(this.gridProgram, 'grid:u_view_projection', 'u_view_projection'),
        false,
        projection.viewProjection,
      )
      const gridColor = colors.grid
      gl.uniform4f(
        this.location(this.gridProgram, 'grid:u_grid_color', 'u_grid_color'),
        gridColor[0],
        gridColor[1],
        gridColor[2],
        gridColor[3],
      )
      gl.drawArrays(gl.LINES, 0, this.gridVertexCount)
    }

    if (this.originAxisVertexCount > 0) {
      gl.useProgram(this.gridProgram)
      gl.bindVertexArray(this.originVertexArray)
      gl.uniformMatrix4fv(
        this.location(this.gridProgram, 'grid:u_view_projection', 'u_view_projection'),
        false,
        projection.viewProjection,
      )
      const axisCount = this.originAxisVertexCount
      const originColors = [colors.originX, colors.originY, colors.origin] as const
      const originRanges = [
        [0, axisCount],
        [axisCount, axisCount],
        [axisCount * 2, this.originDotVertexCount],
      ] as const
      for (let part = 0; part < originRanges.length; part += 1) {
        const color = originColors[part] ?? colors.origin
        const range = originRanges[part] ?? [0, 0]
        if ((range[1] ?? 0) <= 0) continue
        gl.uniform4f(
          this.location(this.gridProgram, 'grid:u_grid_color', 'u_grid_color'),
          color[0],
          color[1],
          color[2],
          color[3],
        )
        gl.drawArrays(gl.TRIANGLES, range[0] ?? 0, range[1] ?? 0)
      }
    }

    this.drawToolpaths(camera, projection, options, colors, lod, options.contactShadow)
    gl.bindVertexArray(null)
    return projection
  }

  private drawToolpaths(
    camera: GcodeCamera,
    projection: GcodeProjection,
    options: GcodeRenderOptions,
    colors: GcodeRenderColors,
    lod: GcodeLod,
    includeShadow: boolean,
  ): void {
    const gl = this.gl
    const layerMinimum = options.showPreviousLayers
      ? Math.min(options.layerMinimum, options.selectedLayer)
      : options.selectedLayer
    const revealCurrentLayer = options.progressStyle === 'live-layer' ? 1 : 0
    if (this.segmentCount <= 0) return
    const tier = lod === 'decimated' || lod === 'coarse' ? this.tierStreams.get(lod) : undefined

    // A reduced tier renders everything below the selected layer; the selected
    // layer itself keeps its full-resolution geometry whenever a frontier is
    // moving across it, so the reveal the user is watching stays segment-exact
    // no matter how far out the camera sits.
    const exactLayer = Boolean(tier) && options.exactActiveLayer
    const tierLayerMaximum = exactLayer ? options.selectedLayer - 1 : options.selectedLayer
    const fullLayerMinimum = exactLayer ? options.selectedLayer : layerMinimum
    /*
     * Translucent geometry makes draw order part of the picture rather than
     * only part of the cost, so the depth ordering below is allowed only when
     * everything this frame draws is opaque. Travels are the one translucent
     * thing today; see drawsBackward for what showing them would otherwise do.
     */
    const opaqueOnly = !options.showTravels
    const widthScale = this.closedSurfaceWidthScale(camera, options)
    const passes: GcodeToolpathPass[] = []
    if (tier && tierLayerMaximum >= layerMinimum) {
      passes.push({
        vertexArray: tier.vertexArray,
        segmentBuffer: tier.segmentBuffer,
        pathDetailBuffer: tier.pathDetailBuffer,
        ranges: this.visibleRanges(
          tier.supergroups,
          projection,
          layerMinimum,
          tierLayerMaximum,
          opaqueOnly,
        ),
        layerMinimum,
        layerMaximum: tierLayerMaximum,
      })
    }
    if (!tier || exactLayer) {
      passes.push({
        vertexArray: this.toolpathVertexArray,
        segmentBuffer: this.toolpathBuffer,
        pathDetailBuffer: this.pathDetailBuffer,
        ranges: this.visibleRanges(
          this.supergroups,
          projection,
          fullLayerMinimum,
          options.selectedLayer,
          opaqueOnly,
        ),
        layerMinimum: fullLayerMinimum,
        layerMaximum: options.selectedLayer,
      })
    }
    const ranges = passes.flatMap((pass) => pass.ranges)
    if (includeShadow && ranges.length > 0) {
      const shadowColor = colors.shadow
      gl.useProgram(this.shadowProgram)
      gl.uniformMatrix4fv(
        this.location(this.shadowProgram, 'shadow:u_view_projection', 'u_view_projection'),
        false,
        projection.viewProjection,
      )
      this.programUniform1(
        this.shadowProgram,
        'shadow',
        'u_extrusion_width',
        Math.max(0.01, options.extrusionWidth),
      )
      this.programUniform1(this.shadowProgram, 'shadow', 'u_width_scale', widthScale)
      this.programUniform1(this.shadowProgram, 'shadow', 'u_bed_z', this.bed.minZ)
      // The visible range is the same for every pass; only the pass band moves.
      // The shadow has no depth ramp, so it needs no floor.
      this.programUniform1(this.shadowProgram, 'shadow', 'u_layer_max', options.selectedLayer)
      this.programUniform1(
        this.shadowProgram,
        'shadow',
        'u_print_progress',
        this.scaledProgress(options),
      )
      this.programUniform1(
        this.shadowProgram,
        'shadow',
        'u_reveal_current_layer',
        revealCurrentLayer,
      )
      this.programUniform4(this.shadowProgram, 'shadow', 'u_shadow_color', shadowColor)
      // All projected pieces share one bed depth. Writing it makes the first
      // piece own each texel, producing a union silhouette instead of an alpha
      // gradient that darkens with every hidden line behind it.
      gl.depthFunc(gl.LESS)
      gl.depthMask(true)
      for (const pass of passes) {
        this.programUniform1(this.shadowProgram, 'shadow', 'u_pass_min', pass.layerMinimum)
        this.programUniform1(this.shadowProgram, 'shadow', 'u_pass_max', pass.layerMaximum)
        for (const range of pass.ranges) {
          this.bindToolpathStart(pass, range.first)
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, range.count)
        }
      }
      gl.depthFunc(gl.LEQUAL)
    }

    /*
     * Every bead is a closed tube, so half of its faces point into its own
     * interior and are certain to lose the depth test. Rasterizing and shading
     * them is the largest piece of pure waste in the frame, and it grows with
     * the file — worth about a fifth of the frame rate on a 115 MB model.
     *
     * This is correct only because the profile winds counter-clockwise as seen
     * from outside. Travel ribbons come through the same program and are not
     * closed, but they survive for a different reason: their winding derives
     * from their own screen-space direction rather than from an absolute axis,
     * so a move drawn either way round presents the same face. The state is
     * scoped to the two programs that draw solids, leaving the grid, the
     * contact shadow, and the pick pass with their own behaviour.
     *
     * The test that matters here is not "does something render" — an inverted
     * winding still renders the tube's inner wall. It is that culling must not
     * change the image at all.
     */
    gl.enable(gl.CULL_FACE)
    gl.cullFace(gl.BACK)
    gl.useProgram(this.toolpathProgram)
    this.uniformMatrix4('u_view_projection', projection.viewProjection)
    this.uniform2('u_resolution', [this.canvas.width, this.canvas.height])
    this.uniform1('u_travel_line_width', 1.25 * this.pixelRatio)
    this.uniform1('u_extrusion_width', Math.max(0.01, options.extrusionWidth))
    this.uniform1('u_width_scale', widthScale)
    this.uniform4('u_extrusion_color', colors.extrusion)
    this.uniform4('u_travel_color', colors.travel)
    this.uniform4('u_progress_color', colors.progress)
    this.uniform4('u_seam_color', colors.seam)
    this.uniform1('u_layer_min', layerMinimum)
    this.uniform1('u_layer_max', options.selectedLayer)
    this.uniform1('u_show_travels', options.showTravels ? 1 : 0)
    this.uniform1('u_print_progress', this.scaledProgress(options))
    this.uniform1('u_reveal_current_layer', revealCurrentLayer)
    this.uniform1('u_normal_flatten', this.normalFlattenFor(camera, options))
    this.uniform1('u_bead_profile', options.beadProfile === 'square' ? 1 : 0)
    this.uniform1('u_highlight_seams', options.highlightSeams ? 1 : 0)
    this.uniform1('u_seam_length', gcodeSeamLength)
    this.uniformInt(
      'u_color_mode',
      options.colorMode === 'feature' ? 1 : options.colorMode === 'feedrate' ? 2 : 0,
    )
    this.uniformFeaturePalette(colors.features)
    this.uniform4('u_feed_slow_color', colors.feedSlow)
    this.uniform4('u_feed_fast_color', colors.feedFast)
    this.uniform2('u_feed_range', [options.feedrateRange[0], options.feedrateRange[1]])
    this.diagnostics.lod = lod
    this.diagnostics.instances = passes.reduce(
      (total, pass) => total + pass.ranges.reduce((sum, range) => sum + range.count, 0),
      0,
    )
    this.diagnostics.drawCalls = passes.reduce((total, pass) => total + pass.ranges.length, 0)
    for (const pass of passes) {
      // The full-resolution pass earns the full profile even when the tier
      // drawn around it is coarse, so the active layer never looks cruder.
      const passIsFull = pass.vertexArray === this.toolpathVertexArray && lod === 'full'
      const profilePoints = this.profilePointsFor(passIsFull ? 'full' : 'reduced', options)
      this.uniform1('u_profile_points', profilePoints)
      this.uniform1('u_pass_min', pass.layerMinimum)
      this.uniform1('u_pass_max', pass.layerMaximum)
      const profileVertexCount = profilePoints * 6
      for (const range of pass.ranges) {
        this.bindToolpathStart(pass, range.first)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, profileVertexCount, range.count)
      }
    }

    /*
     * Caps close path ends, at a facet count matching the body's: a 14-facet
     * body beside a 6-facet cap shows a visible crease. A round bead only earns
     * one while it is still wide enough for its rounded end to read at all,
     * which is why the coarse tiers draw none. A square bead's cap is one flat
     * face over a single band, so it stays cheap enough to keep at every tier —
     * and it has to, because without it the ribbon would end open.
     */
    const square = options.beadProfile === 'square'
    const capPoints = square ? 4 : lod === 'full' ? 14 : lod === 'reduced' ? 6 : 0
    const capBands = square ? 1 : 3
    if (capPoints > 0 && this.capCount > 0) {
      const capRanges = this.visibleRanges(
        this.capSupergroups,
        projection,
        layerMinimum,
        options.selectedLayer,
        opaqueOnly,
      )
      gl.useProgram(this.capProgram)
      gl.uniformMatrix4fv(
        this.location(this.capProgram, 'cap:u_view_projection', 'u_view_projection'),
        false,
        projection.viewProjection,
      )
      this.programUniform1(
        this.capProgram,
        'cap',
        'u_extrusion_width',
        Math.max(0.01, options.extrusionWidth),
      )
      this.programUniform1(this.capProgram, 'cap', 'u_width_scale', widthScale)
      this.programUniform4(this.capProgram, 'cap', 'u_extrusion_color', colors.extrusion)
      this.programUniform4(this.capProgram, 'cap', 'u_progress_color', colors.progress)
      this.programUniform4(this.capProgram, 'cap', 'u_seam_color', colors.seam)
      this.programUniform1(
        this.capProgram,
        'cap',
        'u_highlight_seams',
        options.highlightSeams ? 1 : 0,
      )
      this.programUniform1(this.capProgram, 'cap', 'u_pass_min', layerMinimum)
      this.programUniform1(this.capProgram, 'cap', 'u_pass_max', options.selectedLayer)
      this.programUniform1(this.capProgram, 'cap', 'u_layer_min', layerMinimum)
      this.programUniform1(this.capProgram, 'cap', 'u_layer_max', options.selectedLayer)
      this.programUniform1(this.capProgram, 'cap', 'u_print_progress', this.scaledProgress(options))
      this.programUniform1(this.capProgram, 'cap', 'u_reveal_current_layer', revealCurrentLayer)
      this.programUniform1(
        this.capProgram,
        'cap',
        'u_normal_flatten',
        this.normalFlattenFor(camera, options),
      )
      this.programUniform1(this.capProgram, 'cap', 'u_bead_profile', square ? 1 : 0)
      this.programUniform1(this.capProgram, 'cap', 'u_cap_bands', capBands)
      this.programUniform1(this.capProgram, 'cap', 'u_profile_points', capPoints)
      // Sweep bands x facets x 6 vertices per facet quad.
      const capVertexCount = capBands * capPoints * 6
      for (const range of capRanges) {
        this.bindCapStart(range.first)
        gl.drawArraysInstanced(gl.TRIANGLES, 0, capVertexCount, range.count)
      }
    }
    gl.disable(gl.CULL_FACE)
  }

  /**
   * Tests supergroups before their chunks, so a frame's culling cost scales
   * with visible geometry rather than with total file size. Adjacent surviving
   * chunks merge into one draw call, which is why chunk indices must stay
   * globally ordered within a stream.
   */
  private visibleRanges(
    groups: readonly GcodeChunkSupergroup[],
    projection: GcodeProjection,
    minimumLayer: number,
    maximumLayer: number,
    opaqueOnly: boolean,
  ): Array<{ first: number; count: number }> {
    const ranges: Array<{ first: number; count: number }> = []
    const backward = this.drawsBackward(groups, projection, opaqueOnly)
    for (let step = 0; step < groups.length; step += 1) {
      const group = groups[backward ? groups.length - 1 - step : step]!
      if (group.maximumLayer < minimumLayer || group.minimumLayer > maximumLayer) continue
      if (!gcodeBoundsAreVisible(group.bounds, projection)) continue
      for (const chunk of group.chunks) {
        if (chunk.maximumLayer < minimumLayer || chunk.minimumLayer > maximumLayer) continue
        if (!gcodeBoundsAreVisible(chunk.bounds, projection)) continue
        const previous = ranges.at(-1)
        // Merges only forwards, which is what keeps a reversed walk from
        // rejoining two groups into one call and drawing them in buffer order
        // again — the very order it is trying to avoid.
        if (previous && previous.first + previous.count === chunk.first) {
          previous.count += chunk.count
        } else ranges.push({ first: chunk.first, count: chunk.count })
      }
    }
    return ranges
  }

  /**
   * Whether to walk the supergroups from the end, which is what puts the
   * nearest geometry on screen first.
   *
   * A print is drawn in print order, so its supergroups run bottom to top —
   * and a camera looking down at the model therefore receives it back to front,
   * the worst possible order. Reversing lets the depth test reject a buried
   * fragment before it is shaded, and a model's interior is nearly all buried:
   * measured on a 115 MB file it is worth about 15% at a fitted orbit and 16%
   * close in, on top of what back-face culling saves.
   *
   * `discard` in the fragment shader does not prevent this, which is worth
   * recording because it is the obvious objection. It defers the depth *write*,
   * not the early depth *test* against depth already there — discarding can only
   * remove a fragment, never let one through that would otherwise have failed.
   *
   * The condition is opacity, not any particular setting. Reordering is
   * invisible for opaque geometry and only ever changes speed. The moment
   * something translucent is drawn it changes the picture instead: a travel at
   * 66% alpha drawn before the model behind it makes that model fail the depth
   * test, so the travel blends against the background and reads as opaque.
   * Measured, that is about 1% of pixels — small, but it is a wrong picture, and
   * no amount of frame rate buys it. So translucent frames keep print order, and
   * anything translucent added later inherits the same protection by saying so.
   */
  private drawsBackward(
    groups: readonly GcodeChunkSupergroup[],
    projection: GcodeProjection,
    opaqueOnly: boolean,
  ): boolean {
    if (!opaqueOnly || groups.length < 2) return false
    const first = groups[0]
    const last = groups[groups.length - 1]
    if (!first || !last) return false
    return (
      this.projectedDepth(last.bounds, projection) < this.projectedDepth(first.bounds, projection)
    )
  }

  /**
   * Normalised device depth of a bounds center. Taken from the matrix rather
   * than from the camera's own angles so it stays right whatever convention
   * yaw and pitch use, and whatever the scene matrix does on top of them.
   */
  private projectedDepth(bounds: GcodeBounds, projection: GcodeProjection): number {
    const x = (bounds.minX + bounds.maxX) * 0.5
    const y = (bounds.minY + bounds.maxY) * 0.5
    const z = (bounds.minZ + bounds.maxZ) * 0.5
    const m = projection.viewProjection
    const clipZ = (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0)
    const clipW = (m[3] ?? 0) * x + (m[7] ?? 0) * y + (m[11] ?? 0) * z + (m[15] ?? 0)
    return clipZ / (Math.abs(clipW) < 1e-6 ? 1e-6 : clipW)
  }

  private bindToolpathStart(pass: GcodeToolpathPass, first: number): void {
    const gl = this.gl
    const floatSize = Float32Array.BYTES_PER_ELEMENT
    const segmentStride = gcodeSegmentStride * floatSize
    const segmentOffset = first * segmentStride
    gl.bindVertexArray(pass.vertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, pass.segmentBuffer)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, segmentStride, segmentOffset)
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, segmentStride, segmentOffset + 3 * floatSize)
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, segmentStride, segmentOffset + 6 * floatSize)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, segmentStride, segmentOffset + 10 * floatSize)
    gl.vertexAttribPointer(6, 1, gl.FLOAT, false, segmentStride, segmentOffset + 11 * floatSize)
    gl.vertexAttribPointer(8, 1, gl.FLOAT, false, segmentStride, segmentOffset + 12 * floatSize)
    const detailStride = gcodePathDetailStride * floatSize
    const detailOffset = first * detailStride
    gl.bindBuffer(gl.ARRAY_BUFFER, pass.pathDetailBuffer)
    gl.vertexAttribPointer(4, 4, gl.FLOAT, false, detailStride, detailOffset)
    gl.vertexAttribPointer(5, 2, gl.FLOAT, false, detailStride, detailOffset + 4 * floatSize)
    gl.vertexAttribPointer(7, 2, gl.FLOAT, false, detailStride, detailOffset + 6 * floatSize)
  }

  private bindCapStart(first: number): void {
    const gl = this.gl
    const floatSize = Float32Array.BYTES_PER_ELEMENT
    const stride = gcodeCapStride * floatSize
    const offset = first * stride
    gl.bindVertexArray(this.capVertexArray)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.capBuffer)
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, offset)
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, offset + 3 * floatSize)
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, offset + 5 * floatSize)
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, offset + 8 * floatSize)
  }

  // Reads the depth buffer along the ray through the given viewport position and
  // returns the world point it hits, so the camera can orbit around the surface
  // the view is actually pointing at. Returns null when nothing is hit.
  pickSurfacePoint(
    camera: GcodeCamera,
    options: GcodeRenderOptions,
    screenX: number,
    screenY: number,
  ): [number, number, number] | null {
    if (this.segmentCount <= 0) return null
    // Picking runs an extra geometry pass, so it reads the decimated stream:
    // the pivot only needs a depth good to a fraction of a millimetre, which
    // merged beads still provide.
    const resources = this.ensurePickResources()
    if (!resources) return null
    const gl = this.gl
    const projection = projectionFor(this.bounds, camera, this.width, this.height, this.pickMatrix)
    const deviceWidth = Math.round(this.width * this.pixelRatio)
    const deviceHeight = Math.round(this.height * this.pixelRatio)
    const pointerX = screenX * this.pixelRatio
    const pointerY = deviceHeight - screenY * this.pixelRatio
    const viewportX = Math.round(pickCenter - pointerX)
    const viewportY = Math.round(pickCenter - pointerY)

    // The viewport keeps the full-resolution framing while the tiny framebuffer
    // crops it to the pixels around the pointer, so thin extrusions survive the
    // pick without paying for a full-size offscreen pass.
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.depthFramebuffer)
    gl.viewport(viewportX, viewportY, deviceWidth, deviceHeight)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    this.drawToolpaths(
      camera,
      projection,
      { ...options, showTravels: false },
      pickColors,
      this.lodFor(camera, { ...options, showTravels: false }),
      false,
    )

    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.resolveFramebuffer)
    gl.viewport(0, 0, pickSize, pickSize)
    gl.disable(gl.DEPTH_TEST)
    gl.useProgram(resources.program)
    gl.bindVertexArray(resources.vertexArray)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, resources.depthTexture)
    gl.uniform1i(this.location(resources.program, 'pick:u_depth', 'u_depth'), 0)
    gl.uniform2f(
      this.location(resources.program, 'pick:u_resolution', 'u_resolution'),
      pickSize,
      pickSize,
    )
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.readPixels(0, 0, pickSize, pickSize, gl.RGBA, gl.UNSIGNED_BYTE, this.pickPixels)

    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindVertexArray(null)
    gl.enable(gl.DEPTH_TEST)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, deviceWidth, deviceHeight)

    const hit = this.nearestPickTexel()
    if (!hit) return null
    return unprojectGcodeNdc(
      (2 * (hit.column + 0.5 - viewportX)) / deviceWidth - 1,
      (2 * (hit.row + 0.5 - viewportY)) / deviceHeight - 1,
      2 * hit.depth - 1,
      projection,
    )
  }

  // Scans outwards from the pointer texel and keeps the closest surface in the
  // first ring that contains one, so aiming near a wall still lands on it.
  private nearestPickTexel(): { column: number; row: number; depth: number } | null {
    for (let radius = 0; radius <= pickCenter; radius += 1) {
      let best: { column: number; row: number; depth: number } | null = null
      for (let row = pickCenter - radius; row <= pickCenter + radius; row += 1) {
        for (let column = pickCenter - radius; column <= pickCenter + radius; column += 1) {
          const onRing =
            Math.abs(row - pickCenter) === radius || Math.abs(column - pickCenter) === radius
          if (!onRing) continue
          const offset = (row * pickSize + column) * 4
          const high = this.pickPixels[offset] ?? 255
          const middle = this.pickPixels[offset + 1] ?? 255
          const low = this.pickPixels[offset + 2] ?? 255
          const depth = (high * 65536 + middle * 256 + low) / 16777215
          // Anything sitting on the far plane is empty space, with a margin so a
          // driver rounding the last depth bit differently still reads as empty.
          if (depth >= 1 - 1e-6) continue
          if (best && best.depth <= depth) continue
          best = { column, row, depth }
        }
      }
      if (best) return best
    }
    return null
  }

  private ensurePickResources(): GcodePickResources | null {
    if (this.pickResources) return this.pickResources
    if (this.pickUnavailable) return null
    const gl = this.gl
    const depthFramebuffer = gl.createFramebuffer()
    const resolveFramebuffer = gl.createFramebuffer()
    const depthTexture = gl.createTexture()
    const depthColorTexture = gl.createTexture()
    const resolveTexture = gl.createTexture()
    const vertexArray = gl.createVertexArray()
    if (
      !depthFramebuffer ||
      !resolveFramebuffer ||
      !depthTexture ||
      !depthColorTexture ||
      !resolveTexture ||
      !vertexArray
    ) {
      this.pickUnavailable = true
      return null
    }
    const allocate = (texture: WebGLTexture, format: number): void => {
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, pickSize, pickSize)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    }
    allocate(depthTexture, gl.DEPTH_COMPONENT24)
    allocate(depthColorTexture, gl.RGBA8)
    allocate(resolveTexture, gl.RGBA8)
    gl.bindTexture(gl.TEXTURE_2D, null)

    gl.bindFramebuffer(gl.FRAMEBUFFER, depthFramebuffer)
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      depthColorTexture,
      0,
    )
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0)
    const depthComplete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, resolveFramebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, resolveTexture, 0)
    const resolveComplete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    if (!depthComplete || !resolveComplete) {
      gl.deleteFramebuffer(depthFramebuffer)
      gl.deleteFramebuffer(resolveFramebuffer)
      gl.deleteTexture(depthTexture)
      gl.deleteTexture(depthColorTexture)
      gl.deleteTexture(resolveTexture)
      gl.deleteVertexArray(vertexArray)
      this.pickUnavailable = true
      return null
    }

    this.pickResources = {
      depthFramebuffer,
      depthTexture,
      depthColorTexture,
      resolveFramebuffer,
      resolveTexture,
      program: program(gl, pickVertexShaderSource, pickFragmentShaderSource),
      vertexArray,
    }
    return this.pickResources
  }

  clear(): void {
    this.segmentCount = 0
    this.capCount = 0
    this.renderChunks = []
    this.capRenderChunks = []
    this.supergroups = []
    this.capSupergroups = []
    this.releaseTiers()
    this.toolpathStream.capacity = 0
    this.toolpathStream.used = 0
    this.pathDetailStream.capacity = 0
    this.pathDetailStream.used = 0
    this.capStream.capacity = 0
    this.capStream.used = 0
    this.progressScale = 1
    this.gridVertexCount = 0
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.toolpathBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, 0, this.gl.STATIC_DRAW)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.pathDetailBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, 0, this.gl.STATIC_DRAW)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.capBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, 0, this.gl.STATIC_DRAW)
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.gridBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, 0, this.gl.STATIC_DRAW)
    this.originAxisVertexCount = 0
    this.originDotVertexCount = 0
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.originBuffer)
    this.gl.bufferData(this.gl.ARRAY_BUFFER, 0, this.gl.STATIC_DRAW)
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT)
  }

  dispose(): void {
    this.releaseTiers()
    this.gl.deleteBuffer(this.toolpathBuffer)
    this.gl.deleteBuffer(this.pathDetailBuffer)
    this.gl.deleteBuffer(this.capBuffer)
    this.gl.deleteBuffer(this.gridBuffer)
    this.gl.deleteBuffer(this.originBuffer)
    this.gl.deleteVertexArray(this.toolpathVertexArray)
    this.gl.deleteVertexArray(this.capVertexArray)
    this.gl.deleteVertexArray(this.gridVertexArray)
    this.gl.deleteVertexArray(this.originVertexArray)
    this.gl.deleteProgram(this.toolpathProgram)
    this.gl.deleteProgram(this.capProgram)
    this.gl.deleteProgram(this.gridProgram)
    this.gl.deleteProgram(this.shadowProgram)
    const pick = this.pickResources
    if (pick) {
      this.gl.deleteFramebuffer(pick.depthFramebuffer)
      this.gl.deleteFramebuffer(pick.resolveFramebuffer)
      this.gl.deleteTexture(pick.depthTexture)
      this.gl.deleteTexture(pick.depthColorTexture)
      this.gl.deleteTexture(pick.resolveTexture)
      this.gl.deleteVertexArray(pick.vertexArray)
      this.gl.deleteProgram(pick.program)
      this.pickResources = null
    }
  }

  /**
   * A uniform that a shader declares but never reads is removed by the GLSL
   * compiler, and asking for its location then returns null. Throwing on that
   * aborted the whole frame: an edit that left one uniform unused blanked the
   * viewer entirely, with the real cause three layers away from the symptom.
   * Uploading to a location that does not exist is instead a no-op, which is
   * what the driver would do with it anyway — and it means a shader edit can
   * only ever cost the effect of that one uniform, never the picture.
   */
  private location(program: WebGLProgram, key: string, name: string): WebGLUniformLocation | null {
    const cached = this.uniformLocations.get(key)
    if (cached) return cached
    if (this.absentUniforms.has(key)) return null
    const location = this.gl.getUniformLocation(program, name)
    if (location === null) {
      this.absentUniforms.add(key)
      if (import.meta.env.DEV) console.warn(`G-code viewer: unused WebGL uniform ${name}`)
      return null
    }
    this.uniformLocations.set(key, location)
    return location
  }

  private toolpathLocation(name: string): WebGLUniformLocation | null {
    return this.location(this.toolpathProgram, `toolpath:${name}`, name)
  }

  private programUniform1(program: WebGLProgram, key: string, name: string, value: number): void {
    this.gl.uniform1f(this.location(program, `${key}:${name}`, name), value)
  }

  private programUniform4(
    program: WebGLProgram,
    key: string,
    name: string,
    value: readonly [number, number, number, number],
  ): void {
    this.gl.uniform4f(
      this.location(program, `${key}:${name}`, name),
      value[0],
      value[1],
      value[2],
      value[3],
    )
  }

  private uniformInt(name: string, value: number): void {
    this.gl.uniform1i(this.location(this.toolpathProgram, `toolpath:${name}`, name), value)
  }

  /*
   * Uploaded as one flat array rather than a uniform per feature: the palette
   * is indexed by the value the parser stored, so adding a category later is a
   * table entry rather than a new uniform and a new branch in the shader.
   */
  private uniformFeaturePalette(
    features: ReadonlyArray<readonly [number, number, number, number]>,
  ): void {
    const flat = new Float32Array(gcodeFeatureCount * 4)
    for (let index = 0; index < gcodeFeatureCount; index += 1) {
      const color = features[index] ?? features[0] ?? [0.5, 0.5, 0.5, 1]
      flat.set(color, index * 4)
    }
    this.gl.uniform4fv(
      this.location(this.toolpathProgram, 'toolpath:u_feature_colors', 'u_feature_colors'),
      flat,
    )
  }

  private uniform1(name: string, value: number): void {
    this.gl.uniform1f(this.toolpathLocation(name), value)
  }

  private uniform2(name: string, value: readonly [number, number]): void {
    this.gl.uniform2f(this.toolpathLocation(name), value[0], value[1])
  }

  private uniform4(name: string, value: readonly [number, number, number, number]): void {
    this.gl.uniform4f(this.toolpathLocation(name), value[0], value[1], value[2], value[3])
  }

  private uniformMatrix4(name: string, value: Float32Array): void {
    this.gl.uniformMatrix4fv(this.toolpathLocation(name), false, value)
  }
}
