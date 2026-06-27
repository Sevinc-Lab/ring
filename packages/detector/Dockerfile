# ---- model export stage (heavy; torch lives ONLY here) ----
# Exports yolov8n.onnx from the official ultralytics weights so we never ship
# torch at runtime and don't redistribute weights in the repo. First build is
# slower (downloads the CPU export toolchain once).
FROM python:3.11-slim AS model
WORKDIR /m
# ultralytics pulls full opencv-python, which needs X11/Qt/GL system libs absent
# from the slim image. Swap to opencv-python-headless so the one-off export runs
# without them (+ libglib2.0-0 which headless still links).
RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir ultralytics --extra-index-url https://download.pytorch.org/whl/cpu \
  && pip uninstall -y opencv-python \
  && pip install --no-cache-dir opencv-python-headless
RUN yolo export model=yolov8n.pt format=onnx imgsz=640 && test -f yolov8n.onnx

# ---- runtime stage (lean: onnxruntime + ffmpeg + the .onnx) ----
FROM python:3.11-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV MODEL_PATH=/app/model/yolov8n.onnx

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src
COPY --from=model /m/yolov8n.onnx /app/model/yolov8n.onnx

# main.py uses absolute imports; running the script puts src/ on sys.path.
CMD ["python", "src/main.py"]
