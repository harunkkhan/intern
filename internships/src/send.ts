// iMessage delivery via Spectrum's cloud provider.
//
// The connection is opened lazily on the first actual send. Most of the ~4,300
// monthly polls find nothing new, and handshaking with Spectrum just to discover
// there is nothing to say would be pure overhead.

import { Spectrum } from "spectrum-ts";
import { imessage } from "spectrum-ts/providers/imessage";

// Both types are inferred from the real call expressions rather than written out.
// `imessage` carries three call overloads — (spectrum), (space), (message) — and
// a hand-written `ReturnType<typeof imessage>` silently resolves to the wrong
// one. Deriving from `connect`/`openSpace` also preserves the provider tuple,
// which is what proves to the type system that this app has the iMessage
// provider attached.
export function connect(projectId: string, projectSecret: string) {
  return Spectrum({
    projectId,
    projectSecret,
    providers: [imessage.config()],
  });
}

export type App = Awaited<ReturnType<typeof connect>>;

/** Throws rather than returning partial credentials — half a pair is a typo. */
export function readCredentials(): { projectId: string; projectSecret: string } {
  const projectId = process.env.PROJECT_ID;
  const projectSecret = process.env.PROJECT_SECRET;
  if (!projectId || !projectSecret) {
    throw new Error(
      "PROJECT_ID and PROJECT_SECRET are required to send iMessages. " +
        "Find them in Settings at https://app.photon.codes",
    );
  }
  return { projectId, projectSecret };
}

// `space.create` takes a bare phone string, so no separate user lookup is needed.
// (The bundled skill docs show `im.space(user)`; that predates spectrum-ts 12,
// where `space` became a namespace with `create`/`get`.)
function openSpace(app: App, phone: string) {
  return imessage(app).space.create(phone);
}

type IMessageSpace = Awaited<ReturnType<typeof openSpace>>;

export interface Messenger {
  send(phone: string, text: string): Promise<void>;
  close(): Promise<void>;
}

/** Prints instead of sending. Used by `--dry-run`. */
export function createDryRunMessenger(): Messenger {
  return {
    async send(phone, text) {
      console.log(`\n--- would send to ${phone} ---\n${text}\n---`);
    },
    async close() {},
  };
}

export function createMessenger(): Messenger {
  let appPromise: Promise<App> | null = null;
  const spaces = new Map<string, IMessageSpace>();

  function getApp(): Promise<App> {
    if (!appPromise) {
      const { projectId, projectSecret } = readCredentials();
      appPromise = connect(projectId, projectSecret);
    }
    return appPromise;
  }

  return {
    async send(phone, text) {
      const app = await getApp();
      let space = spaces.get(phone);
      if (!space) {
        space = await openSpace(app, phone);
        spaces.set(phone, space);
      }
      await space.send(text);
    },
    async close() {
      // Spectrum holds an open gRPC stream; without stopping it the Action would
      // sit at its timeout instead of finishing.
      if (!appPromise) return;
      try {
        await (await appPromise).stop();
      } catch {
        // A shutdown failure doesn't invalidate messages already delivered.
      }
    },
  };
}
