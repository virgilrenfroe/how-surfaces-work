FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY index.html main.js README.md .nojekyll /srv/
COPY sheen/ /srv/sheen/
COPY fresnel/ /srv/fresnel/
EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
