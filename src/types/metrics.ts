export type Metric = {
  value: number;
  threshold: number;
  strategy: "greater" | "less";
};

export type MetricEntry = {
  metric: Metric;
  bool: boolean;
};

export type Metrics = Record<string, MetricEntry>;

export type MetricResult<T> = {
  input: T;
  metric: Metric;
};

export type MetricsResult<T> = {
  passed: boolean;
  results: Record<string, MetricResult<T>>;
};
