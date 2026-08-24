import type { EraPack, Person, Place, TimelineEvent } from "../content/schema";
import type { GameState, StateDelta } from "./state";

/**
 * Deterministic contradiction checks against the Era Pack.
 *
 * This is cheap code that catches most of what breaks immersion in an LLM
 * narrative: talking to someone who is dead, standing in a town that has been
 * burned, walking a distance that takes two days, or a story clock that runs
 * backwards. None of it needs a model.
 */

export interface CanonViolation {
  code:
    | "date-backwards"
    | "date-out-of-range"
    | "unknown-place"
    | "place-not-yet"
    | "place-gone"
    | "person-dead"
    | "person-not-born"
    | "person-absent"
    | "travel-too-fast"
    | "fixed-event-contradicted";
  message: string;
  /** Blocking violations force a narrator retry; advisory ones are logged. */
  blocking: boolean;
}

/** Parse a `YYYY`, `YYYY-MM` or `YYYY-MM-DD` date to a comparable number. */
export function dateKey(d: string): number {
  const [y = "0", m = "01", day = "01"] = d.split("-");
  return Number(y) * 10000 + Number(m) * 100 + Number(day);
}

/** Days between two historical dates, treating months as 30 days. */
export function daysBetween(a: string, b: string): number {
  const toDays = (d: string) => {
    const [y = "0", m = "1", day = "1"] = d.split("-");
    return Number(y) * 360 + (Number(m) - 1) * 30 + Number(day);
  };
  return toDays(b) - toDays(a);
}

function isDeadBy(person: Person, date: string): boolean {
  return !!person.died && dateKey(date) > dateKey(person.died);
}

function isUnbornAt(person: Person, date: string): boolean {
  return !!person.born && dateKey(date) < dateKey(person.born);
}

function placeExistsAt(place: Place, date: string): CanonViolation | null {
  const k = dateKey(date);
  if (place.exists_from && k < dateKey(place.exists_from)) {
    return {
      code: "place-not-yet",
      message: `${place.name} does not exist until ${place.exists_from}.`,
      blocking: true,
    };
  }
  if (place.exists_until && k > dateKey(place.exists_until)) {
    return {
      code: "place-gone",
      message: `${place.name} is gone after ${place.exists_until}.`,
      blocking: true,
    };
  }
  return null;
}

/** Travel time between two places, in hours, if the pack knows a route. */
export function routeHours(
  pack: EraPack,
  fromId: string,
  toId: string,
): number | null {
  const from = pack.places.find((p) => p.id === fromId);
  const direct = from?.routes.find((r) => r.to === toId);
  if (direct) return direct.hours;
  const to = pack.places.find((p) => p.id === toId);
  const reverse = to?.routes.find((r) => r.to === fromId);
  return reverse?.hours ?? null;
}

/**
 * Check a proposed delta against the pack and the current state.
 *
 * Returns every violation found rather than the first, so a retry prompt can
 * tell the narrator everything that was wrong in one pass.
 */
export function checkCanon(
  pack: EraPack,
  state: GameState,
  delta: StateDelta,
): CanonViolation[] {
  const out: CanonViolation[] = [];
  const nextDate = delta.date ?? state.date;
  const nextPlaceId = delta.place_id ?? state.place_id;

  // --- Time -----------------------------------------------------------------
  if (delta.date) {
    if (dateKey(delta.date) < dateKey(state.date)) {
      out.push({
        code: "date-backwards",
        message: `Story clock moved backwards: ${state.date} -> ${delta.date}.`,
        blocking: true,
      });
    }
    const { start, end } = pack.meta.date_range;
    if (dateKey(delta.date) < dateKey(start) || dateKey(delta.date) > dateKey(end)) {
      out.push({
        code: "date-out-of-range",
        message: `${delta.date} is outside this pack's range (${start} to ${end}).`,
        blocking: true,
      });
    }
  }

  // --- Place ----------------------------------------------------------------
  const place = pack.places.find((p) => p.id === nextPlaceId);
  if (!place) {
    out.push({
      code: "unknown-place",
      message: `No place "${nextPlaceId}" in this Era Pack.`,
      blocking: true,
    });
  } else {
    const existence = placeExistsAt(place, nextDate);
    if (existence) out.push(existence);
  }

  // --- Travel ---------------------------------------------------------------
  if (delta.place_id && delta.place_id !== state.place_id) {
    const hours = routeHours(pack, state.place_id, delta.place_id);
    if (hours !== null) {
      const elapsedHours = daysBetween(state.date, nextDate) * 24;
      if (elapsedHours < hours) {
        out.push({
          code: "travel-too-fast",
          message:
            `Travel from ${state.place_id} to ${delta.place_id} takes about ` +
            `${hours}h, but only ${Math.max(0, elapsedHours)}h have passed. ` +
            `Advance the date.`,
          // Advisory: dates are coarse and a same-day short trip is legitimate.
          // Only flag it so the narrator can correct on the next turn.
          blocking: hours > 24,
        });
      }
    }
  }

  // --- People ---------------------------------------------------------------
  for (const rel of delta.relationships) {
    if (rel.person_id.startsWith("fictional:")) continue;
    const person = pack.people.find((p) => p.id === rel.person_id);
    if (!person) continue; // unknown ids are the auditor's problem, not canon's
    if (isDeadBy(person, nextDate)) {
      out.push({
        code: "person-dead",
        message: `${person.name} died ${person.died}; cannot appear on ${nextDate}.`,
        blocking: true,
      });
    }
    if (isUnbornAt(person, nextDate)) {
      out.push({
        code: "person-not-born",
        message: `${person.name} is not born until ${person.born}.`,
        blocking: true,
      });
    }
    if (person.presence.length > 0) {
      const present = person.presence.some(
        (w) =>
          w.place_id === nextPlaceId &&
          dateKey(nextDate) >= dateKey(w.from) &&
          (!w.until || dateKey(nextDate) <= dateKey(w.until)),
      );
      if (!present) {
        out.push({
          code: "person-absent",
          message:
            `${person.name} is not recorded at ${nextPlaceId} on ${nextDate}. ` +
            `Known presence: ` +
            person.presence
              .map((w) => `${w.place_id} ${w.from}-${w.until ?? "…"}`)
              .join("; "),
          // Advisory: the record is incomplete and people did travel.
          blocking: false,
        });
      }
    }
  }

  return out;
}

/** Fixed timeline events falling in a window — the ones a story cannot avert. */
export function fixedEventsBetween(
  pack: EraPack,
  from: string,
  to: string,
): TimelineEvent[] {
  const lo = dateKey(from);
  const hi = dateKey(to);
  return pack.timeline
    .filter((e) => e.fixed && dateKey(e.date) >= lo && dateKey(e.date) <= hi)
    .sort((a, b) => dateKey(a.date) - dateKey(b.date));
}

/** The next fixed event the story is heading toward from `date`. */
export function nextFixedEvent(
  pack: EraPack,
  date: string,
): TimelineEvent | null {
  const k = dateKey(date);
  return (
    pack.timeline
      .filter((e) => e.fixed && dateKey(e.date) >= k)
      .sort((a, b) => dateKey(a.date) - dateKey(b.date))[0] ?? null
  );
}
