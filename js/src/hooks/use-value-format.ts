import { createContext, useContext } from "react";
import type { ValueFormat } from "../utils/format-value.ts";

export const ValueFormatContext = createContext<ValueFormat>("json");

/** Read the current value display format from context. */
export const useValueFormat = (): ValueFormat => useContext(ValueFormatContext);
