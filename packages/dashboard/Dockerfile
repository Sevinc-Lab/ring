# ---- model export stage (heavy; torch lives ONLY here) ----
# Exports yolov8n.onnx so the BROWSER can run YOLO locally for the live overlay
# (served from /models). Mirrors the detector's export so we never ship torch at
# runtime nor commit weights to the repo. First build is slower (one-off).
FROM python:3.11-slim AS model
WORKDIR /m
RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 \
  && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir ultralytics --extra-index-url https://download.pytorch.org/whl/cpu \
  && pip uninstall -y opencv-python \
  && pip install --no-cache-dir opencv-python-headless
RUN yolo export model=yolov8n.pt format=onnx imgsz=640 && test -f yolov8n.onnx

# ---- build stage ----
FROM node:20-alpine AS build
WORKDIR /app

# Toolchain for compiling better-sqlite3's native binding.
RUN apk add --no-cache python3 make g++

COPY package.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json next.config.mjs next-env.d.ts ./
COPY src ./src

# Static assets for the in-browser detector: the ONNX model + onnxruntime-web's
# WASM binaries (served locally from /models and /ort — no CDN).
# Only the wasm-only entry + its SIMD runtime are needed (~13 MB); the glob
# variants (webgpu/jsep) would add ~64 MB we never load.
RUN mkdir -p public/models public/ort \
  && cp node_modules/onnxruntime-web/dist/ort.wasm.min.mjs public/ort/ \
  && cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs public/ort/ \
  && cp node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm public/ort/
COPY --from=model /m/yolov8n.onnx public/models/yolov8n.onnx

RUN npm run build
# Drop dev dependencies; keep next + react + better-sqlite3 (with its native binary).
RUN npm prune --omit=dev --no-audit --no-fund

# ---- runtime stage ----
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY package.json next.config.mjs next-env.d.ts ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public

EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]
