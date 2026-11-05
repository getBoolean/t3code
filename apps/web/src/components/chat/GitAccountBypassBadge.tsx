// Fork: Make a thread machine-login bypass visible and reversible from the chat header.
import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { type GitAccountGuardTarget, useGitAccountGuard } from "./useGitAccountGuard";

/** Shows that the thread runs as this machine's git login, and turns the bypass off on click. */
export function GitAccountBypassBadge(props: { readonly target: GitAccountGuardTarget }) {
  const { status, setThreadBypass } = useGitAccountGuard(props.target);
  if (status?.state !== "bypassed") return null;
  const machine = status.machine;
  const author =
    machine?.authorName && machine.authorEmail
      ? `${machine.authorName} <${machine.authorEmail}>`
      : "this machine's git config";
  const forge = machine?.forgeLogin
    ? ` and uses the ${machine.host} login "${machine.forgeLogin}"`
    : "";
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Badge
            variant="warning"
            size="sm"
            render={<button type="button" />}
            onClick={() => void setThreadBypass(false)}
          />
        }
      >
        Machine git login
      </TooltipTrigger>
      <TooltipPopup side="top">
        {`The git account "${status.accountLabel ?? "unknown"}" can't be used: ${status.reason ?? "unknown reason"}. This thread commits as ${author}${forge}. Click to go back to the account.`}
      </TooltipPopup>
    </Tooltip>
  );
}
