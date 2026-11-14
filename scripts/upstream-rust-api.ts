import { z } from "zod";
import { rustReference } from "./rust-api-source.ts";
import { referenceUpdate } from "./upstream-reference.ts";

const updater = referenceUpdate(rustReference);
export const rustPlanSchema = updater.planSchema;
export type RustPlan = z.infer<typeof rustPlanSchema>;
export const prepareRust = updater.prepare;
export const rustUpdate = updater.update;
