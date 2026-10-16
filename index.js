/**
 * Host half of the Ctrl + Wheel Zoom bundle.
 *
 * Page zoom is a browser-side concern, so the Host contributes no service and
 * no tool: this row exists so the plugin manager can install, list, enable and
 * disable the bundle. The Client half ({@link ./client.js}) owns the wheel
 * listener, the zoom state and the two UI surfaces.
 */
export function apply() {}
