import { NextResponse } from "next/server";
import { z } from "zod";
import { idSchema, parseBody } from "@/lib/api/body";
import { simulateFill } from "@/lib/engine/pos";

export const runtime = "nodejs";

// A B1 billing request as a pharmacy would submit it. Quantities and days
// supply are bounded because they are multiplied through the pricing engine,
// where a submitted 1e308 is not a claim but a way to make arithmetic
// meaningless.
const BODY = z.object({
  memberId: idSchema,
  drugId: idSchema,
  pharmacyId: idSchema,
  dateOfService: z.string().min(1).max(40),
  quantityDispensed: z.number().positive().max(1_000_000),
  daysSupply: z.number().int().positive().max(365),
  dawCode: z.string().max(2),
  prescriberNpi: z.string().max(20).nullish(),
  levelOfService: z.string().max(2).nullish(),
});

export async function POST(request: Request) {
  const body = await parseBody(request, BODY);
  if (!body.ok) return body.response;

  try {
    return NextResponse.json(await simulateFill(body.data));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Adjudication failed" },
      { status: 400 },
    );
  }
}
