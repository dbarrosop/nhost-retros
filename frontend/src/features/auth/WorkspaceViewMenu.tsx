import { Link } from "@tanstack/react-router";
import { DisclosureChevron } from "../../components/DisclosureChevron";
import { HeaderMenu } from "../../components/HeaderMenu";

export function WorkspaceViewMenu({
  facilitating,
  canSwitch,
}: {
  facilitating: boolean;
  canSwitch: boolean;
}) {
  if (!canSwitch) return <span className="workspace-view-label">Participant view</span>;
  return (
    <HeaderMenu
      className="view-menu"
      summary={
        <>
          {facilitating ? "Facilitator view" : "Participant view"}
          <DisclosureChevron />
        </>
      }
    >
      <div className="popup-panel header-menu-panel view-menu-panel">
        <p className="small-label popup-label">Switch view</p>
        <Link
          className="popup-item"
          to="/workspace"
          aria-current={!facilitating ? "true" : undefined}
        >
          Participant view
          {!facilitating && <span aria-hidden="true">✓</span>}
        </Link>
        <Link
          className="popup-item"
          to="/facilitate"
          aria-current={facilitating ? "true" : undefined}
        >
          Facilitator view
          {facilitating && <span aria-hidden="true">✓</span>}
        </Link>
      </div>
    </HeaderMenu>
  );
}
