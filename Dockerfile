FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html main.js README.md .nojekyll /srv/
COPY sheen/ /srv/sheen/
COPY coat/ /srv/coat/
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
