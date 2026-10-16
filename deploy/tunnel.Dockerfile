# cloudflared plus a shell watchdog (the official image is distroless, so it has no shell).
FROM cloudflare/cloudflared:latest AS cloudflared

FROM alpine:3.20
COPY --from=cloudflared /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY deploy/tunnel-watchdog.sh /usr/local/bin/tunnel-watchdog
RUN chmod 755 /usr/local/bin/tunnel-watchdog && adduser -D -u 65532 tunnel
USER tunnel
ENTRYPOINT ["/usr/local/bin/tunnel-watchdog"]
