import { DocumentList } from "./DocumentList";
import { DetailPane } from "./DetailPane";

export function SplitView() {
  return (
    <div className="split-view">
      <DocumentList />
      <DetailPane />
    </div>
  );
}
