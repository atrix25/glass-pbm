import { dispensingWeightForProduct } from "../src/lib/clinical/dispensing-volume.js";

for (const n of [
  "LANTUS INJ",
  "NOVOLOG INJ",
  "LEVEMIR INJ",
  "TRESIBA INJ",
  "VASCEPA CAP",
  "LOVAZA CAP",
  "OZEMPIC INJ",
  "INSULIN GLARGINE SOLN PEN-INJ",
  "amiloride/hydrochlorothiazide tab",
]) {
  const w = dispensingWeightForProduct(n, null);
  console.log(
    `  ${n.padEnd(34)} ${(w / 1e6).toFixed(1)}M${w === 200000 ? "  FLOOR" : ""}`,
  );
}
