// Fork: Compose the main files route above thread navigation to avoid cycling through inspector previews; remove when upstream separates pane and root file screens.
import { ThreadRouteScreen } from "../threads/ThreadRouteScreen";
import { ThreadFilesTreeScreen, type ThreadFilesRouteScreenProps } from "./ThreadFilesRouteScreen";

export function ThreadFilesTreeRouteScreen(props: ThreadFilesRouteScreenProps) {
  return (
    <ThreadFilesTreeScreen
      {...props}
      renderThread={(screen) => <ThreadRouteScreen {...screen} />}
    />
  );
}
