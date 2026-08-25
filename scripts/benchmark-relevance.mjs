/* global URL, console, process */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { applyBoundedRankingSignals, MAX_RERANKER_SCORE_FLOOR } from "../src/server/memory/signals.ts";
import { aggregateMetrics } from "../benchmarks/metrics.mjs";
import { assertDataset } from "../benchmarks/validate.mjs";

const DEFAULT_DATASET = new URL("../benchmarks/relevance.example.json", import.meta.url);

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function baseline(query) {
  return query.candidates
    .filter((candidate) => candidate.score >= MAX_RERANKER_SCORE_FLOOR)
    .slice()
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .map((candidate) => candidate.id);
}

function withSignals(query, memoryById, now) {
  const candidates = query.candidates.map((candidate) => ({
    memory: memoryById.get(candidate.id),
    score: candidate.score,
    rerankerScore: candidate.score,
  }));
  return applyBoundedRankingSignals(candidates, query.query, now).map((candidate) => candidate.memory.id);
}

function rows(dataset, ranker) {
  const memoryById = new Map(dataset.memories.map((memory) => [memory.id, memory]));
  const now = new Date(dataset.now);
  return dataset.queries.map((query) => ({
    id: query.id,
    category: query.category,
    results: ranker(query, memoryById, now),
    relevant: query.relevant,
    graded: query.graded ?? Object.fromEntries(query.relevant.map((id) => [id, 3])),
    expectNoResult: query.expectNoResult === true,
  }));
}

function roundedMetrics(metrics) {
  return Object.fromEntries(Object.entries(metrics).map(([key, value]) => [
    key,
    typeof value === "number" ? Number(value.toFixed(6)) : value,
  ]));
}

const datasetPath = argumentValue("--dataset");
const datasetText = await readFile(datasetPath ? pathToFileURL(datasetPath) : DEFAULT_DATASET, "utf8");
const dataset = JSON.parse(datasetText);
assertDataset(dataset);

const baselineRows = rows(dataset, (query) => baseline(query));
const latencySamples = [];
const rankedRows = rows(dataset, (query, memoryById, now) => {
  const start = performance.now();
  const result = withSignals(query, memoryById, now);
  latencySamples.push(performance.now() - start);
  return result;
});
const metrics = aggregateMetrics(rankedRows, latencySamples);
const baselineMetrics = aggregateMetrics(baselineRows);

console.log(JSON.stringify({
  dataset: datasetPath ?? "benchmarks/relevance.example.json",
  now: dataset.now,
  baseline: roundedMetrics(baselineMetrics),
  ranked: roundedMetrics(metrics),
  deltas: roundedMetrics(Object.fromEntries(Object.keys(metrics).flatMap((key) => {
    if (typeof metrics[key] !== "number" || typeof baselineMetrics[key] !== "number") return [];
    return [[key, metrics[key] - baselineMetrics[key]]];
  }))),
  perQuery: rankedRows.map((row, index) => ({
    id: row.id,
    category: row.category,
    baselineTop: baselineRows[index].results[0] ?? null,
    rankedTop: row.results[0] ?? null,
    expected: row.relevant[0] ?? null,
    expectedNoResult: row.expectNoResult,
  })),
}, null, 2));
