import { useEffect, useState } from "react";

import { api } from "../api";
import type { LifecycleActivity } from "../types";

function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function LifecycleActivityPanel() {
  const [events, setEvents] = useState<LifecycleActivity[]>([]);
  const [filter, setFilter] = useState<"all" | LifecycleActivity["subjectType"]>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.lifecycleActivity()
      .then((result) => setEvents(result.events))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Lifecycle activity could not be loaded"))
      .finally(() => setLoading(false));
  }, []);

  const visible = filter === "all" ? events : events.filter((event) => event.subjectType === filter);
  return (
    <section className="lifecycle-activity" aria-label="Global lifecycle activity">
      <header>
        <div><p className="eyebrow">GLOBAL ACTIVITY</p><strong>Every lifecycle change, one evidence trail.</strong></div>
        <nav aria-label="Activity filters">
          {(["all", "memory", "project", "task"] as const).map((value) => (
            <button type="button" key={value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{value}</button>
          ))}
        </nav>
      </header>
      {loading ? <div className="activity-loading">Loading lifecycle evidence…</div>
        : error ? <p className="error-copy" role="alert">{error}</p>
          : visible.length ? <ol>{visible.map((event) => {
            const sourceUrl = safeUrl(event.sourceUrl);
            return <li key={event.id}>
              <span className={`activity-mark activity-mark--${event.subjectType}`} aria-hidden="true" />
              <div><small>{event.subjectType} · {event.eventType}</small><strong>{event.subjectTitle}</strong><span>{event.model ?? event.client ?? event.actorType} · {new Date(event.createdAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}</span></div>
              {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">Source ↗</a> : null}
            </li>;
          })}</ol> : <div className="portfolio-empty">No lifecycle evidence in this view yet.</div>}
    </section>
  );
}
