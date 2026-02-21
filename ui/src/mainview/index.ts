import ElectrobunView from "electrobun/view";
import type { MyRPCSchema } from "../shared/rpc.ts";

const rpc = ElectrobunView.Electroview.defineRPC<MyRPCSchema>({
  maxRequestTime: 15000,
  handlers: {
    requests: {},
    messages: {},
  },
});

new ElectrobunView.Electroview({ rpc });

console.log("Hello Electrobun view loaded!");

const logsEl = document.getElementById("dtu-logs");

rpc.addMessageListener("dtuLog", (log: string) => {
  if (logsEl) {
    if (logsEl.innerText === "Waiting for DTU logs...\n") {
      logsEl.innerText = "";
    }
    logsEl.innerText += log;
    logsEl.scrollTop = logsEl.scrollHeight;
  }
});

const launchBtn = document.getElementById("launch-dtu-btn");
const statusEl = document.getElementById("dtu-status");

if (launchBtn && statusEl) {
  let isRunning = false;
  launchBtn.addEventListener("click", async () => {
    launchBtn.setAttribute("disabled", "true");

    if (isRunning) {
      statusEl.innerText = "Stopping...";
      statusEl.style.color = "orange";

      try {
        const success = await rpc.request.stopDTU();
        if (success) {
          isRunning = false;
          statusEl.innerText = "Offline";
          statusEl.style.color = "#888";
          launchBtn.innerText = "Launch DTU";
          launchBtn.removeAttribute("disabled");
        } else {
          statusEl.innerText = "Error";
          statusEl.style.color = "red";
          launchBtn.removeAttribute("disabled");
        }
      } catch (e) {
        console.error("Error stopping DTU:", e);
        statusEl.innerText = "Error";
        statusEl.style.color = "red";
        launchBtn.removeAttribute("disabled");
      }
    } else {
      statusEl.innerText = "Starting...";
      statusEl.style.color = "orange";

      try {
        const success = await rpc.request.launchDTU();
        if (success) {
          isRunning = true;
          statusEl.innerText = "Online";
          statusEl.style.color = "lightgreen";
          launchBtn.innerText = "Stop DTU";
          launchBtn.removeAttribute("disabled");
        } else {
          statusEl.innerText = "Failed";
          statusEl.style.color = "red";
          launchBtn.removeAttribute("disabled");
        }
      } catch (e) {
        console.error("Error launching DTU:", e);
        statusEl.innerText = "Error";
        statusEl.style.color = "red";
        launchBtn.removeAttribute("disabled");
      }
    }
  });
}
