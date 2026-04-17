import { afterEach } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup } from "@testing-library/react";

GlobalRegistrator.register();

// @testing-library/react auto-cleans up between tests only when the test
// runner exposes afterEach as a global. bun:test does not, so wire it here.
afterEach(cleanup);
