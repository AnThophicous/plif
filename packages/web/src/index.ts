/**
 * @plif/web — public surface.
 *
 * The only thing a caller needs: spawn a web server that bridges a browser
 * xterm.js client to the plif CLI running inside a real PTY. The CLI itself is
 * never imported here; the caller supplies the command to run, so there is no
 * dependency cycle and the adapter stays reusable.
 */
export { startWebServer } from './server.js';
export type { WebServerOptions, WebServerHandle } from './server.js';
