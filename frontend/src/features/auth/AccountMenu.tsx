import { HeaderMenu } from "../../components/HeaderMenu";
import { ParticipantAvatar } from "../../components/ParticipantAvatar";
import { useAuth } from "../../lib/auth";

export function AccountMenu() {
  const { session, store } = useAuth();
  return (
    <HeaderMenu
      className="account-menu"
      summary={
        <>
          <ParticipantAvatar
            name={session?.user?.displayName || session?.user?.email || "Account"}
          />
          <span>Account</span>
        </>
      }
    >
      <div className="popup-panel header-menu-panel">
        <div className="account-menu-identity">
          <span className="small-label">Signed in as</span>
          <p>{session?.user?.email}</p>
        </div>
        <button className="popup-item" type="button" onClick={() => void store.signOut()}>
          Sign out
        </button>
      </div>
    </HeaderMenu>
  );
}
