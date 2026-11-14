import { pbtSource } from "./property-testing-source.ts";
import { adaptedUpdate } from "./upstream-adapted.ts";
const adapter = adaptedUpdate(pbtSource);
export const pbtPlanSchema = adapter.schema;
export const preparePbt = adapter.prepare;
export const pbtUpdate = adapter.update;
