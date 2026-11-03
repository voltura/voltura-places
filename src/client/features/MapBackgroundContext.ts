import { createContext } from "react";
import type { Preferences } from "../foundation/preferences";

export const MapBackgroundContext = createContext<Preferences["mapBackground"]>("osm");
