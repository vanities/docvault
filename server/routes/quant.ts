// Quant route entrypoint — compatibility barrel for the split quant backend.
// Compute internals, dispatch, cache policy, HTTP helpers, and indicators live under server/routes/quant/.

export * from './quant/engine.js';
export { handleQuantRoutes } from './quant/router.js';
