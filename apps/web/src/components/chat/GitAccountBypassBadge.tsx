// Fork: Make a thread machine-login bypass visible and reversible from the chat header.
import { T, useGT } from "gt-react";

import { Badge } from "../ui/badge";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { type GitAccountGuardTarget, useGitAccountGuard } from "./useGitAccountGuard";

/** Shows that the thread runs as this machine's git login, and turns the bypass off on click. */
export function GitAccountBypassBadge(props: { readonly target: GitAccountGuardTarget }) {
  const gt = useGT();
  const { status, setThreadBypass } = useGitAccountGuard(props.target);
  if (status?.state !== "bypassed") return null;
  const machine = status.machine;
  const unusable = gt('The git account "{account}" can\'t be used: {reason}.', {
    account: status.accountLabel ?? gt("unknown", { $context: "missing git account name" }),
    reason: status.reason ?? gt("unknown reason"),
  });
  const author =
    machine?.authorName && machine.authorEmail
      ? `${machine.authorName} <${machine.authorEmail}>`
      : null;
  const login = machine?.forgeLogin
    ? { host: String(machine.host), login: machine.forgeLogin }
    : null;
  const commitsAs =
    author === null
      ? login === null
        ? gt("This thread commits as this machine's git config.")
        : gt(
            'This thread commits as this machine\'s git config and uses the {host} login "{login}".',
            login,
          )
      : login === null
        ? gt("This thread commits as {author}.", { author })
        : gt('This thread commits as {author} and uses the {host} login "{login}".', {
            author,
            ...login,
          });
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
        <T>Machine git login</T>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {`${unusable} ${commitsAs} ${gt("Click to go back to the account.")}`}
      </TooltipPopup>
    </Tooltip>
  );
}
