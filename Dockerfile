# What a host that builds from this repository runs (Dokku, by git push): the
# page as `npm run build` writes it, served as plain files. It is the demo
# yard that way, as from any static server; following a yard as it runs takes
# scripts/serve.mjs beside that yard (INSTALL.md).

# The build needs the devDependencies (vite, typescript); the image does not.
FROM node:24-alpine AS build
WORKDIR /app
# From the lockfile, as .yardr/test does, and before the sources so that an
# edit to them does not install again.
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The build can exit 0 and write no page.
RUN npm run build && test -s dist/index.html

# nginx listens on 80 and its image says so (EXPOSE 80), which is the port
# Dokku then proxies to: nothing here names a port.
FROM nginx:1.29-alpine
COPY --from=build /app/dist /usr/share/nginx/html
