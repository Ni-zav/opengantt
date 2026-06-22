import { Container, getContainer, switchPort } from "@cloudflare/containers";
import { env } from "cloudflare:workers";

export class OpenGanttCollaboration extends Container {
  defaultPort = 1234;
  requiredPorts = [1234, 1235];
  sleepAfter = "10m";
  envVars = {
    NODE_ENV: "production",
    COLLAB_PORT: "1234",
    COLLAB_MONITORING_PORT: "1235",
    SUPABASE_URL: env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS
  };
}

export default {
  async fetch(request, bindings) {
    const container = getContainer(bindings.COLLABORATION, "primary");
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") return container.fetch(request);
    if (new URL(request.url).pathname === "/health") {
      const healthRequest = new Request(new URL("/health", request.url), request);
      return container.fetch(switchPort(healthRequest, 1235));
    }
    return new Response("Not found", { status: 404 });
  }
};
