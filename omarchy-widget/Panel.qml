import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "proxy-router"
  ipcTarget: "proxy-router"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property color urgent: bar ? bar.urgent : Color.urgent
  readonly property color dim: Qt.darker(foreground, 1.45)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property bool isActive: hostWidget ? hostWidget.isActive : false
  readonly property bool daemonRunning: hostWidget ? hostWidget.daemonRunning : false
  readonly property bool isWhitelisted: hostWidget ? hostWidget.isWhitelisted : false
  readonly property bool isWhitelisting: hostWidget ? hostWidget.isWhitelisting : false
  readonly property string whitelistStatus: hostWidget ? hostWidget.whitelistStatus : ""
  readonly property bool vpsHealth: hostWidget ? hostWidget.vpsHealth : false
  readonly property int vpsLatencyMs: hostWidget ? hostWidget.vpsLatencyMs : -1
  readonly property string publicIp: hostWidget ? hostWidget.publicIp : ""
  readonly property string upstreamHost: hostWidget ? hostWidget.upstreamHost : ""
  readonly property string upstreamProtocol: hostWidget ? hostWidget.upstreamProtocol : "http"
  readonly property int upstreamPort: hostWidget ? hostWidget.upstreamPort : 3128
  readonly property int activeServicesCount: hostWidget ? hostWidget.activeServicesCount : 0
  readonly property int totalServicesCount: hostWidget ? hostWidget.totalServicesCount : 10
  readonly property int totalWhitelistedIps: hostWidget ? hostWidget.totalWhitelistedIps : 0
  readonly property string errorMessage: hostWidget ? hostWidget.errorMessage : ""
  readonly property string lastUpdated: hostWidget ? hostWidget.lastUpdated : ""
  readonly property var configData: hostWidget ? hostWidget.configData : null

  readonly property string currentToken: {
    if (configData && configData.server && configData.server.authToken) {
      return configData.server.authToken
    }
    return ""
  }

  function refresh() {
    if (hostWidget && hostWidget.refresh) hostWidget.refresh()
  }

  function toggleProxy() {
    if (hostWidget && hostWidget.toggleProxy) hostWidget.toggleProxy()
  }

  function whitelistCurrentIp() {
    if (hostWidget && hostWidget.whitelistCurrentIp) hostWidget.whitelistCurrentIp()
  }

  function setProtocol(proto) {
    if (hostWidget && hostWidget.setProtocol) hostWidget.setProtocol(proto)
  }

  function setToken(tok) {
    if (hostWidget && hostWidget.setToken) hostWidget.setToken(tok)
  }

  function toggleSite(siteId) {
    if (hostWidget && hostWidget.toggleSite) hostWidget.toggleSite(siteId)
  }

  function addCustomDomain(domain) {
    if (hostWidget && hostWidget.addCustomDomain) hostWidget.addCustomDomain(domain)
  }

  function removeCustomDomain(domain) {
    if (hostWidget && hostWidget.removeCustomDomain) hostWidget.removeCustomDomain(domain)
  }

  function launchTerminal() {
    if (hostWidget && hostWidget.launchTerminal) hostWidget.launchTerminal()
  }

  function editSettings() {
    if (hostWidget && hostWidget.editSettings) hostWidget.editSettings()
  }

  function copyEnvToClipboard() {
    var port = root.upstreamPort || 8183
    var cmd = "export http_proxy=http://127.0.0.1:8183 https_proxy=http://127.0.0.1:8183 all_proxy=http://127.0.0.1:8183"
    Quickshell.clipboardText = cmd
  }

  function copyPacUrlToClipboard() {
    Quickshell.clipboardText = "http://127.0.0.1:8182/proxy.pac"
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(380))
    contentHeight: panel.fittedContentHeight(flickable.contentHeight + Style.space(24), Style.space(620))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTextKey: function(t) {
        if (t === "r" || t === "R") root.refresh()
        if (t === "t" || t === "T") root.toggleProxy()
        if (t === "w" || t === "W") root.whitelistCurrentIp()
      }

      Flickable {
        id: flickable
        anchors.fill: parent
        contentWidth: width
        contentHeight: mainColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height

        Column {
          id: mainColumn
          width: flickable.width
          spacing: Style.space(12)

          // ── 1. Hero Section ────────────────────────────────────────────────
          Row {
            width: parent.width
            spacing: Style.space(12)

            BorderSurface {
              width: Style.space(40)
              height: Style.space(40)
              radius: Style.cornerRadius
              color: root.isActive ? Style.hoverFillFor(root.foreground, Color.accent) : Style.hoverFillFor(root.dim, root.dim)
              borderSpec: Border.controlSpec("normal", root.isActive ? Color.accent : root.dim, Color.accent)

              Text {
                anchors.centerIn: parent
                text: "󱂇"
                color: root.isActive ? Color.accent : root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
              }
            }

            Column {
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(2)
              width: parent.width - Style.space(40) - Style.space(12) - headerControls.width - Style.space(8)

              Text {
                text: "PROXY ROUTER"
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.body
                font.bold: true
                font.letterSpacing: 1.1
              }

              Text {
                text: "SPLIT TUNNELING & STEALTH"
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
                font.letterSpacing: 0.8
                elide: Text.ElideRight
                width: parent.width
              }
            }

            Row {
              id: headerControls
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(8)

              PanelActionButton {
                iconText: "󰑮"
                tooltipText: "Обновить статус (R)"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onClicked: root.refresh()
              }

              ToggleSwitch {
                checked: root.isActive
                busy: root.isWhitelisting
                foreground: root.foreground
                accent: Color.accent
                onToggled: root.toggleProxy()
              }
            }
          }

          // ── 2. Mini Planet Visualizer Preview ───────────────────────────────
          BorderSurface {
            width: parent.width
            height: Style.space(160)
            radius: Style.cornerRadius
            color: Qt.rgba(0.04, 0.04, 0.06, 0.65)
            borderSpec: Border.controlSpec("normal", root.isActive ? Color.accent : root.dim, Color.accent)

            PlanetView {
              anchors.fill: parent
              isActive: root.isActive
              isConnecting: root.isWhitelisting
              isError: !root.vpsHealth
            }
          }

          // ── 3. Public IP & Kernel Whitelist Card ────────────────────────────
          BorderSurface {
            width: parent.width
            radius: Style.cornerRadius
            color: Style.hoverFillFor(root.foreground, root.foreground)
            borderSpec: Border.controlSpec("normal", root.isWhitelisted ? Color.accent : root.dim, Color.accent)

            Column {
              width: parent.width - Style.space(20)
              anchors.centerIn: parent
              spacing: Style.space(8)
              topPadding: Style.space(10)
              bottomPadding: Style.space(10)

              Row {
                width: parent.width

                Column {
                  width: parent.width - wlBadge.width
                  spacing: Style.space(2)

                  Text {
                    text: "ВНЕШНИЙ IPv4 (WAN)"
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    font.bold: true
                    font.letterSpacing: 0.8
                  }

                  Text {
                    text: root.publicIp !== "" ? root.publicIp : "Определяется..."
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.title
                    font.bold: true
                  }
                }

                BorderSurface {
                  id: wlBadge
                  anchors.verticalCenter: parent.verticalCenter
                  implicitWidth: wlText.implicitWidth + Style.space(12)
                  implicitHeight: wlText.implicitHeight + Style.space(6)
                  radius: Style.cornerRadius
                  color: root.isWhitelisted ? Style.hoverFillFor(Color.accent, Color.accent) : Style.hoverFillFor(root.urgent, root.urgent)
                  borderSpec: Border.controlSpec("normal", root.isWhitelisted ? Color.accent : root.urgent, Color.accent)

                  Text {
                    id: wlText
                    anchors.centerIn: parent
                    text: root.isWhitelisted ? "ВАЙТЛИСТ ✓" : "НЕ В ВАЙТЛИСТЕ"
                    color: root.isWhitelisted ? Color.accent : root.urgent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    font.bold: true
                  }
                }
              }

              Row {
                width: parent.width
                spacing: Style.space(8)

                BorderSurface {
                  width: parent.width - wlBtn.width - Style.space(8)
                  height: Style.space(30)
                  radius: Style.cornerRadius
                  color: "transparent"

                  Text {
                    anchors.verticalCenter: parent.verticalCenter
                    text: "Авто-вайтлист IP: Вкл (" + root.totalWhitelistedIps + " в nftables)"
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                  }
                }

                BorderSurface {
                  id: wlBtn
                  width: wlBtnText.implicitWidth + Style.space(16)
                  height: Style.space(30)
                  radius: Style.cornerRadius
                  color: Style.selectedFillFor(root.foreground, Color.accent)
                  borderSpec: Border.controlSpec("normal", root.foreground, Color.accent)

                  Row {
                    anchors.centerIn: parent
                    spacing: Style.space(4)

                    Text {
                      text: "󰄡"
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      anchors.verticalCenter: parent.verticalCenter
                    }

                    Text {
                      id: wlBtnText
                      text: "Вайтлист мой IP"
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      font.bold: true
                      anchors.verticalCenter: parent.verticalCenter
                    }
                  }

                  MouseArea {
                    anchors.fill: parent
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.whitelistCurrentIp()
                  }
                }
              }
            }
          }

          // ── 4. Active Tunnel Node & Endpoints Card ──────────────────────────
          BorderSurface {
            width: parent.width
            radius: Style.cornerRadius
            color: Style.hoverFillFor(root.foreground, root.foreground)
            borderSpec: Border.controlSpec("normal", root.dim, Color.accent)

            Column {
              width: parent.width - Style.space(20)
              anchors.centerIn: parent
              spacing: Style.space(6)
              topPadding: Style.space(10)
              bottomPadding: Style.space(10)

              Row {
                width: parent.width

                Column {
                  width: parent.width - srvBadge.width
                  spacing: Style.space(2)

                  Text {
                    text: "АКТИВНЫЙ ТУННЕЛЬ (NODE)"
                    color: root.dim
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    font.bold: true
                    font.letterSpacing: 0.8
                  }

                  Text {
                    text: root.upstreamProtocol.toUpperCase() + "://" + root.upstreamHost + ":" + root.upstreamPort
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    font.bold: true
                  }
                }

                BorderSurface {
                  id: srvBadge
                  anchors.verticalCenter: parent.verticalCenter
                  implicitWidth: srvText.implicitWidth + Style.space(12)
                  implicitHeight: srvText.implicitHeight + Style.space(6)
                  radius: Style.cornerRadius
                  color: root.vpsHealth ? Style.hoverFillFor(Color.accent, Color.accent) : Style.hoverFillFor(root.urgent, root.urgent)
                  borderSpec: Border.controlSpec("normal", root.vpsHealth ? Color.accent : root.urgent, Color.accent)

                  Text {
                    id: srvText
                    anchors.centerIn: parent
                    text: root.vpsHealth ? ("GOST v3 • " + root.vpsLatencyMs + "ms") : "ОФЛАЙН"
                    color: root.vpsHealth ? Color.accent : root.urgent
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    font.bold: true
                  }
                }
              }

              Text {
                text: "PAC: http://127.0.0.1:8182/proxy.pac • Forwarder: :8183"
                color: root.dim
                font.family: root.fontFamily
                font.pixelSize: Style.font.caption * 0.9
                elide: Text.ElideRight
                width: parent.width
              }
            }
          }

          // ── 6. Routing Summary ─────────────────────────────────────────────
          BorderSurface {
            width: parent.width
            radius: Style.cornerRadius
            color: Style.hoverFillFor(root.foreground, root.foreground)
            borderSpec: Border.controlSpec("normal", root.dim, Color.accent)

            Row {
              width: parent.width - Style.space(20)
              anchors.centerIn: parent
              topPadding: Style.space(8)
              bottomPadding: Style.space(8)
              spacing: Style.space(8)

              Text {
                text: "󰄲"
                color: Color.accent
                font.family: root.fontFamily
                font.pixelSize: Style.font.title
                anchors.verticalCenter: parent.verticalCenter
              }

              Column {
                width: parent.width - Style.space(32)
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(2)

                Text {
                  text: "СПЛИТ-ТУННЕЛИРОВАНИЕ (" + root.activeServicesCount + "/" + root.totalServicesCount + " АКТИВНО)"
                  color: root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption
                  font.bold: true
                  font.letterSpacing: 0.8
                }

                Text {
                  text: "Все 10 AI-сервисов включены • CLI: proxy-router list / toggle"
                  color: root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.caption * 0.9
                  elide: Text.ElideRight
                  width: parent.width
                }
              }
            }
          }

          PanelSeparator {
            foreground: root.foreground
          }

          // ── 7. Bottom Buttons ───────────────────────────────────────────────
          Row {
            width: parent.width
            spacing: Style.space(8)
            bottomPadding: Style.space(6)

            BorderSurface {
              width: (parent.width - Style.space(24)) / 4
              height: Style.space(34)
              radius: Style.cornerRadius
              color: Style.hoverFillFor(root.foreground, root.foreground)
              borderSpec: Border.controlSpec("normal", root.dim, Color.accent)

              Row {
                anchors.centerIn: parent
                spacing: Style.space(4)
                Text { text: "󰞌"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                Text { text: "Терминал"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.caption * 0.9; font.bold: true }
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.launchTerminal()
              }
            }

            BorderSurface {
              width: (parent.width - Style.space(24)) / 4
              height: Style.space(34)
              radius: Style.cornerRadius
              color: Style.hoverFillFor(root.foreground, root.foreground)
              borderSpec: Border.controlSpec("normal", root.dim, Color.accent)

              Row {
                anchors.centerIn: parent
                spacing: Style.space(4)
                Text { text: "󰆏"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                Text { text: "Копия env"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.caption * 0.9; font.bold: true }
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.copyEnvToClipboard()
              }
            }

            BorderSurface {
              width: (parent.width - Style.space(24)) / 4
              height: Style.space(34)
              radius: Style.cornerRadius
              color: Style.hoverFillFor(root.foreground, root.foreground)
              borderSpec: Border.controlSpec("normal", root.dim, Color.accent)

              Row {
                anchors.centerIn: parent
                spacing: Style.space(4)
                Text { text: "󰒍"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                Text { text: "PAC URL"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.caption * 0.9; font.bold: true }
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.copyPacUrlToClipboard()
              }
            }

            BorderSurface {
              id: cfgBtn
              width: (parent.width - Style.space(24)) / 4
              height: Style.space(34)
              radius: Style.cornerRadius
              color: Style.hoverFillFor(root.foreground, Color.accent)
              borderSpec: Border.controlSpec("normal", root.dim, Color.accent)

              Row {
                anchors.centerIn: parent
                spacing: Style.space(4)
                Text { text: "󰒓"; color: Color.accent; font.family: root.fontFamily; font.pixelSize: Style.font.caption }
                Text { text: "Конфиг"; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.caption * 0.9; font.bold: true }
              }

              MouseArea {
                anchors.fill: parent
                cursorShape: Qt.PointingHandCursor
                onClicked: root.editSettings()
              }
            }
          }
        }
      }
    }
  }
}
