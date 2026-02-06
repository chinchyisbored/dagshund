/** Ambient type declaration for pre-bundled dagre.
 *  dagre v2's ESM dist wraps require() in a dynamic shim that Bun's browser
 *  bundler can't trace. We pre-bundle the CJS dist (which has static requires)
 *  into a browser-compatible ESM file at src/vendor/dagre.js. */
declare module "../vendor/dagre.js" {
  export * from "@dagrejs/dagre";
  import dagre from "@dagrejs/dagre";
  export default dagre;
}
