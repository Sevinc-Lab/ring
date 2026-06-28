# Caddy mit DuckDNS-DNS-Modul (für Let's-Encrypt DNS-01 — kein offener Port 80 nötig).
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
