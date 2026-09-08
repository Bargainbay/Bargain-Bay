// Is the driver in the middle of something a page reload would throw away?
//
// Everything they TAP survives anything — it is in the offline queue the moment
// it happens. A half-filled close-out is not: the signature they have just
// drawn, eight photos, the damage answers and the printed name live only in the
// open form until Done is pressed. So when a new build takes over the app, it
// waits for the sheet to close rather than reloading the screen out from under
// somebody standing in a customer's kitchen.
//
// A counter, not a boolean: the photo sheet can open on top of the close-out.
let held = 0;

export const holdReload = () => { held += 1; };
export const releaseReload = () => { held = Math.max(0, held - 1); };
export const reloadHeld = () => held > 0;
