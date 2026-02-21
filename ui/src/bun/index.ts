import { BrowserWindow, Utils, Tray, defineElectrobunRPC } from "electrobun/bun";
import path from "node:path";
import net from "node:net";
import type { MyRPCSchema } from "../shared/rpc.ts";

// Spawn background processes for the OA app
let procs: any[] = [];
let dtuProc: any = null;

async function startBackgroundProcesses() {
  // Supervisor can be started here or later through similar buttons if needed
}

startBackgroundProcesses();

const rpc = defineElectrobunRPC<MyRPCSchema, "bun">("bun", {
  handlers: {
    requests: {
      launchDTU: async () => {
        if (dtuProc) {
          return true;
        }
        console.log("Starting DTU server...");
        try {
          dtuProc = Bun.spawn(["pnpm", "--filter", "dtu-github-actions", "dev"], {
            cwd: path.join(import.meta.dirname, "../../.."),
            env: process.env,
            stdout: "pipe",
            stderr: "pipe",
          });
          procs.push(dtuProc);

          const readOutput = async (stream: ReadableStream | null) => {
            if (!stream) {
              return;
            }
            const reader = stream.getReader();
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              const text = decoder.decode(value);
              // Use the global rpc object directly to send to attached webviews
              rpc.send.dtuLog(text);
            }
          };

          readOutput(dtuProc.stdout);
          readOutput(dtuProc.stderr);

          // Poll port 8910 until it becomes available
          const start = Date.now();
          let isOnline = false;
          while (Date.now() - start < 10000) {
            try {
              await new Promise<void>((resolve, reject) => {
                const socket = new net.Socket();
                socket.setTimeout(250);
                socket.once("connect", () => {
                  socket.destroy();
                  resolve();
                });
                socket.once("timeout", () => {
                  socket.destroy();
                  reject(new Error("timeout"));
                });
                socket.once("error", (err) => {
                  socket.destroy();
                  reject(err);
                });
                socket.connect(8910, "127.0.0.1");
              });
              isOnline = true;
              break;
            } catch {
              await new Promise((r) => setTimeout(r, 250));
            }
          }

          if (!isOnline) {
            dtuProc.kill();
            dtuProc = null;
            return false;
          }

          return true;
        } catch (e) {
          console.error("Failed to start DTU:", e);
          return false;
        }
      },
      stopDTU: async () => {
        if (dtuProc) {
          dtuProc.kill();
          procs = procs.filter((p) => p !== dtuProc);
          dtuProc = null;
        }
        return true;
      },
    },
  },
});

// In electrobun, main.js runs in Contents/MacOS/../Resources
// Our asset config copies the image to the app/assets folder.
const trayIconPath = path.join(import.meta.dirname, "../assets/tray.png");
console.log("Resolved tray icon path: ", trayIconPath);

import { type MenuItemConfig } from "electrobun/bun";

// Define the menu structure
const _trayMenu: MenuItemConfig[] = [
  { label: "Status: Online", type: "normal", enabled: false }, // Explicit "normal" type fixes TS strict checks
  { type: "divider" },
  { label: "Quit", type: "normal", action: "quit-app" },
];

// Create a system tray notification/icon
const tray = new Tray({
  title: "OA",
  image: trayIconPath,
  template: true, // Turn off template mode to allow standard colored PNGs
});

// The setMenu must be called explicitly to map the config into the native layer
// (some versions of electrobun drop the menu arg from the Tray constructor)
// Commented out temporarily to test direct icon clicks!
// tray.setMenu(_trayMenu);

tray.on("tray-clicked", (e: any) => {
  if (e.data?.action === "quit-app") {
    procs.forEach((p) => p.kill());
    Utils.quit();
  }
});

// Create the main application window
const mainWindow = new BrowserWindow({
  title: "OA Desktop",
  url: "views://mainview/index.html",
  rpc,
  frame: {
    width: 800,
    height: 800,
    x: 200,
    y: 200,
  },
});

// Quit the app when the main window is closed
mainWindow.on("close", () => {
  procs.forEach((p) => p.kill());
  Utils.quit();
});

console.log("OA Electrobun app started!");
