import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "proxy-router"

  property bool isActive: false
  property bool daemonRunning: false
  property bool isWhitelisted: false
  property bool isWhitelisting: false
  property string whitelistStatus: ""
  property bool vpsHealth: false
  property int vpsLatencyMs: -1
  property string publicIp: ""
  property string upstreamHost: ""
  property string upstreamProtocol: "http"
  property int upstreamPort: 3128
  property int activeServicesCount: 0
  property int totalServicesCount: 10
  property int totalWhitelistedIps: 0
  property string errorMessage: ""
  property string lastUpdated: ""
  property var configData: null

  readonly property string homeDir: Quickshell.env("HOME") || ""
  readonly property string ctlScript: {
    var resolved = String(Qt.resolvedUrl("proxy_router_ctl.py")).replace(/^file:\/\//, "")
    if (resolved && resolved.indexOf("proxy_router_ctl.py") !== -1) {
      return resolved
    }
    return homeDir + "/.config/omarchy/plugins/proxy-router/proxy_router_ctl.py"
  }

  readonly property color statusColor: {
    if (!vpsHealth) return Color.urgent
    if (isActive) return Color.accent
    return bar ? bar.barForeground : Color.foreground
  }

  readonly property string displayLabel: {
    if (!vpsHealth) return "󱂇 ERR"
    if (isWhitelisting) return "󱂇 AUTH..."
    return isActive ? "󱂇 ON" : "󱂇 OFF"
  }

  readonly property string tooltipText: {
    var lines = []
    lines.push("Proxy Router: " + (isActive ? "Активен (Split Tunneling)" : "Отключен"))
    lines.push("Сервер: " + upstreamHost + " (" + upstreamProtocol.toUpperCase() + ":" + upstreamPort + " • " + (vpsHealth ? (vpsLatencyMs + "мс") : "недоступен") + ")")
    lines.push("Внешний IP: " + (publicIp !== "" ? publicIp : "определяется...") + (isWhitelisted ? " (Вайтлист ✓)" : " (Не в вайтлисте)"))
    lines.push("Маршрутизация: " + activeServicesCount + "/" + totalServicesCount + " сервисов")
    lines.push("ЛКМ: Управление • ПКМ: Вкл/Выкл • СКМ: Вайтлист IP")
    return lines.join("\n")
  }

  function applyJson(raw) {
    if (!raw) return
    var str = String(raw).trim()
    var start = str.indexOf('{')
    var end = str.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) return
    try {
      var d = JSON.parse(str.substring(start, end + 1))
      if (d.isActive !== undefined) root.isActive = (d.isActive === true)
      if (d.daemonRunning !== undefined) root.daemonRunning = (d.daemonRunning === true)
      if (d.isWhitelisted !== undefined) root.isWhitelisted = (d.isWhitelisted === true)
      if (d.isWhitelisting !== undefined) root.isWhitelisting = (d.isWhitelisting === true)
      if (d.whitelistStatus !== undefined) root.whitelistStatus = d.whitelistStatus || ""
      if (d.vpsHealth !== undefined) root.vpsHealth = (d.vpsHealth === true)
      if (d.vpsLatencyMs !== undefined) root.vpsLatencyMs = d.vpsLatencyMs
      if (d.publicIp !== undefined) root.publicIp = d.publicIp || ""
      if (d.upstreamHost !== undefined) root.upstreamHost = d.upstreamHost || ""
      if (d.upstreamProtocol !== undefined) root.upstreamProtocol = d.upstreamProtocol || "http"
      if (d.upstreamPort !== undefined) root.upstreamPort = d.upstreamPort || 3128
      if (d.activeServicesCount !== undefined) root.activeServicesCount = d.activeServicesCount || 0
      if (d.totalServicesCount !== undefined) root.totalServicesCount = d.totalServicesCount || 10
      if (d.totalWhitelistedIps !== undefined) root.totalWhitelistedIps = d.totalWhitelistedIps || 0
      if (d.error !== undefined) root.errorMessage = d.error || ""
      if (d.lastUpdated !== undefined) root.lastUpdated = d.lastUpdated || ""
    } catch (e) {
      console.warn("proxy-router parse error:", e)
    }
  }

  function reloadConfig() {
    configFile.reload()
  }

  function refresh() {
    stateFile.reload()
    if (!pollProc.running) {
      pollProc.command = ["python3", root.ctlScript, "status", "--json"]
      pollProc.running = true
    }
  }

  function toggleProxy() {
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "toggle", "--json"]
      actionProc.running = true
    }
  }

  function whitelistCurrentIp() {
    root.isWhitelisting = true
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "whitelist", "--json"]
      actionProc.running = true
    }
  }

  function setProtocol(proto) {
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "set-protocol", proto, "--json"]
      actionProc.running = true
    }
  }

  function setToken(tok) {
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "set-token", tok, "--json"]
      actionProc.running = true
    }
  }

  function toggleSite(siteId) {
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "toggle-site", siteId, "--json"]
      actionProc.running = true
    }
  }

  function addCustomDomain(domain) {
    if (!domain) return
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "add-domain", domain, "--json"]
      actionProc.running = true
    }
  }

  function removeCustomDomain(domain) {
    if (!domain) return
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "remove-domain", domain, "--json"]
      actionProc.running = true
    }
  }

  function launchTerminal() {
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "launch-terminal"]
      actionProc.running = true
    }
  }

  function editSettings() {
    if (!actionProc.running) {
      actionProc.command = ["python3", root.ctlScript, "config"]
      actionProc.running = true
    }
  }

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  FileView {
    id: stateFile
    path: root.homeDir + "/.cache/proxy-router/state.json"
    watchChanges: true
    printErrors: false
    onLoaded: root.applyJson(text())
    onFileChanged: root.applyJson(text())
  }

  FileView {
    id: configFile
    path: root.homeDir + "/.config/proxy-router/settings.json"
    watchChanges: true
    printErrors: false
    onLoaded: {
      try {
        var str = text()
        if (str) root.configData = JSON.parse(str)
      } catch (e) {}
    }
    onFileChanged: {
      try {
        var str = text()
        if (str) root.configData = JSON.parse(str)
      } catch (e) {}
    }
  }

  Component.onCompleted: {
    stateFile.reload()
    configFile.reload()
    Qt.callLater(root.refresh)
  }

  Process {
    id: pollProc
    command: ["python3", root.ctlScript, "status", "--json"]

    stdout: StdioCollector {
      id: pollStdout
      waitForEnd: true
      onStreamFinished: {
        root.applyJson(pollStdout.text)
        root.reloadConfig()
      }
    }
  }

  Process {
    id: actionProc
    command: []

    stdout: StdioCollector {
      id: actionStdout
      waitForEnd: true
      onStreamFinished: {
        root.isWhitelisting = false
        root.refresh()
      }
    }

    stderr: StdioCollector {
      id: actionStderr
      waitForEnd: true
      onStreamFinished: {
        root.isWhitelisting = false
        var err = String(actionStderr.text || "").trim()
        if (err !== "") console.warn("proxy-router error:", err)
      }
    }
  }

  // Periodic poll timer (every 25 seconds)
  Timer {
    interval: 25000
    running: true
    repeat: true
    onTriggered: root.refresh()
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "proxy-router"

    function refresh(): void { root.refresh() }
    function toggle(): void { root.toggleProxy() }
    function connect(): void { if (!root.isActive) root.toggleProxy() }
    function disconnect(): void { if (root.isActive) root.toggleProxy() }
    function open(): void { root.open() }
    function close(): void { root.close() }
    function show(): void { root.open() }
    function hide(): void { root.close() }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.displayLabel
    active: root.isActive
    activeColor: root.statusColor
    useActiveColor: true
    dimmed: !root.isActive
    fontSize: Style.font.caption
    horizontalMargin: 8
    tooltipText: root.tooltipText

    onPressed: function(b) {
      if (b === Qt.RightButton) {
        root.toggleProxy()
      } else if (b === Qt.MiddleButton) {
        root.whitelistCurrentIp()
      } else {
        root.togglePanel()
      }
    }
  }
}
