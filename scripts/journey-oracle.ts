// The journey oracle (fix-journey-oracle design decision 2): a feature is
// native only when every reachable journey that exercises it is at parity.
// Everything else is a unit claim; an open defect may force a row buggy.

export interface OracleJourney {
  slug: string;
  status: string;
  scope?: string;
  features?: string[];
  acceptedDiffs?: Array<{ checkpoint: string; reason: string }>;
}

export interface OracleFeature {
  id: string;
  status: string;
  defect?: string;
}

export type NativeLabel = "journey-verified" | "unit-verified only";

export function linkedJourneys<T extends OracleJourney>(featureId: string, journeys: readonly T[]): T[] {
  return journeys.filter(
    (journey) => journey.scope === "reachable" && (journey.features ?? []).includes(featureId),
  );
}

/** A journey is clean only at parity; a diverges row keeps an unaccepted difference. */
export function journeyClean(journey: OracleJourney): boolean {
  return journey.status === "parity";
}

export function featureOracle(featureId: string, journeys: readonly OracleJourney[]) {
  const linked = linkedJourneys(featureId, journeys);
  const label: NativeLabel =
    linked.length > 0 && linked.every(journeyClean) ? "journey-verified" : "unit-verified only";
  return { linked, label };
}
