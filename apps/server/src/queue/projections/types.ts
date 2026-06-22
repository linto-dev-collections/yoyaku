import type { BatchItem } from "drizzle-orm/batch";
import type { ProjectionMessage } from "../../types";

/** db.batch に渡す drizzle 文（D1=sqlite 方言）。 */
export type ProjectionStmt = BatchItem<"sqlite">;

export type Projection = {
  /** positions.projection の値。ソース集約 ID ごとに gap 検知する。 */
  name: string;
  /**
   * このストリーム（aggregateType）を購読するか。購読中は **全イベントで position を前進**させ、
   * read model 変更が無いイベントでは apply が空配列を返す（seq 連続性＝gap 検知の前提）。
   */
  subscribesTo: (aggregateType: ProjectionMessage["aggregateType"]) => boolean;
  /** read model 更新文（このイベントで変更が無ければ空配列）。consumer が positions 前進と同一 batch で実行。 */
  apply: (msg: ProjectionMessage) => ProjectionStmt[];
};
