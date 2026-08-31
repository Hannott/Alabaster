# A fake Moonraker for development. Never part of a release, and never
# something a printer runs — see `dev/fake-printer/README.md`.
FROM python:3.13-alpine

WORKDIR /app

# Pillow ships wheels for musl on the architectures this runs on; the build
# tools stay out of the image so it starts in a second or two.
RUN pip install --no-cache-dir aiohttp==3.11.11 pillow==11.1.0

COPY fake_moonraker.py ./

EXPOSE 7125

CMD ["python", "-u", "fake_moonraker.py"]
