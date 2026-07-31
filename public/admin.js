const treeEl = document.getElementById("tree");
const wsProtocol = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${wsProtocol}//${location.host}/ws/admin`);

function renderTree(tree) {
  const byParent = new Map();
  for (const channel of tree) {
    if (!byParent.has(channel.parentId)) byParent.set(channel.parentId, []);
    byParent.get(channel.parentId).push(channel);
  }

  function renderLevel(parentId, depth) {
    const channels = (byParent.get(parentId) ?? []).sort((a, b) => a.order - b.order);
    return channels
      .map((channel) => {
        const indent = "  ".repeat(depth);
        const clients = channel.clients.map((c) => `${indent}    - ${c.nickname} (id ${c.id})`).join("\n");
        return `${indent}# ${channel.name} (id ${channel.id})\n${clients}\n${renderLevel(channel.id, depth + 1)}`;
      })
      .join("");
  }

  treeEl.textContent = renderLevel(0, 0) || "(каналов нет)";
}

socket.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (msg.type === "tree") renderTree(msg.tree);
  if (msg.type === "error") console.error("[admin]", msg.message);
});

socket.addEventListener("open", () => {
  treeEl.textContent = "ожидание дерева каналов...";
});
