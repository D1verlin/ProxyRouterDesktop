import QtQuick
import qs.Commons
import "EarthData.js" as EarthData

Item {
  id: root
  implicitWidth: Style.space(340)
  implicitHeight: Style.space(240)

  property bool isActive: false
  property bool isConnecting: false
  property bool isError: false
  property real rotX: 0.32
  property real rotY: 0.45
  property real packetProgress: 0.0

  // Coordinates for Мой ПК (Client) and Прокси (VPS)
  readonly property real clientLat: 0.9409   // ~53.9° N
  readonly property real clientLon: 0.4800   // ~27.5° E
  readonly property real proxyLat: 0.8744    // ~50.1° N
  readonly property real proxyLon: 0.1500    // ~8.6° E

  function toUnit(lat, lon) {
    return {
      nx: Math.cos(lat) * Math.sin(lon),
      ny: Math.sin(lat),
      nz: Math.cos(lat) * Math.cos(lon)
    }
  }

  readonly property var clientUnit: toUnit(clientLat, clientLon)
  readonly property var proxyUnit: toUnit(proxyLat, proxyLon)

  function projectUnit(u, r, cx, cy) {
    var cosY = Math.cos(root.rotY), sinY = Math.sin(root.rotY)
    var cosX = Math.cos(root.rotX), sinX = Math.sin(root.rotX)

    // Rotate Y
    var x0 = u.nx * cosY + u.nz * sinY
    var y0 = u.ny
    var z0 = -u.nx * sinY + u.nz * cosY

    // Rotate X
    var y1 = y0 * cosX - z0 * sinX
    var z1 = y0 * sinX + z0 * cosX

    return {
      x: cx + x0 * r,
      y: cy - y1 * r,
      z: z1,
      visible: z1 > -0.05
    }
  }

  Canvas {
    id: canvas
    anchors.fill: parent
    renderTarget: Canvas.FramebufferObject
    renderStrategy: Canvas.Threaded

    onPaint: {
      var ctx = getContext("2d")
      ctx.clearRect(0, 0, width, height)

      var cx = width * 0.5
      var cy = height * 0.5
      var r = Math.min(width, height) * 0.44

      // Subtle atmospheric halo behind Earth
      var grad = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 1.05)
      if (root.isError) {
        grad.addColorStop(0, "rgba(239, 68, 68, 0.08)")
        grad.addColorStop(1, "rgba(239, 68, 68, 0.0)")
      } else if (root.isActive) {
        grad.addColorStop(0, "rgba(100, 200, 255, 0.09)")
        grad.addColorStop(1, "rgba(0, 0, 0, 0.0)")
      } else {
        grad.addColorStop(0, "rgba(255, 255, 255, 0.03)")
        grad.addColorStop(1, "rgba(0, 0, 0, 0.0)")
      }
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2)
      ctx.fill()

      // 1. Draw Dot-Matrix Continental Micro-Dots
      var dots = EarthData.DOTS
      var cosY = Math.cos(root.rotY), sinY = Math.sin(root.rotY)
      var cosX = Math.cos(root.rotX), sinX = Math.sin(root.rotX)

      for (var i = 0; i < dots.length; i++) {
        var d = dots[i]
        // Rotate Y
        var x0 = d[0] * cosY + d[2] * sinY
        var y0 = d[1]
        var z0 = -d[0] * sinY + d[2] * cosY

        // Rotate X
        var y1 = y0 * cosX - z0 * sinX
        var z1 = y0 * sinX + z0 * cosX

        if (z1 > 0) {
          var px = cx + x0 * r
          var py = cy - y1 * r
          var alpha = 0.18 + z1 * 0.82

          if (root.isError) {
            ctx.fillStyle = "rgba(239, 68, 68, " + alpha + ")"
          } else if (root.isActive) {
            ctx.fillStyle = "rgba(255, 255, 255, " + (alpha * 0.95) + ")"
          } else {
            ctx.fillStyle = "rgba(255, 255, 255, " + (alpha * 0.45) + ")"
          }

          var dotSize = (z1 > 0.5) ? 2.0 : 1.5
          ctx.fillRect(px - dotSize * 0.5, py - dotSize * 0.5, dotSize, dotSize)
        }
      }

      // 2. Parabolic Optical Beam (Мой ПК -> Прокси)
      var pClient = root.projectUnit(root.clientUnit, r, cx, cy)
      var pProxy = root.projectUnit(root.proxyUnit, r, cx, cy)

      var segments = 16
      var arcPoints = []
      var anyVisible = false

      for (var s = 0; s <= segments; s++) {
        var t = s / segments
        var lat = root.clientLat + (root.proxyLat - root.clientLat) * t
        var lon = root.clientLon + (root.proxyLon - root.clientLon) * t
        var alt = Math.sin(t * Math.PI) * (r * 0.22)
        var pt = root.projectUnit(root.toUnit(lat, lon), r + alt, cx, cy)
        arcPoints.push(pt)
        if (pt.visible) anyVisible = true
      }

      if (anyVisible) {
        ctx.beginPath()
        for (var k = 0; k < arcPoints.length; k++) {
          if (k === 0) ctx.moveTo(arcPoints[k].x, arcPoints[k].y)
          else ctx.lineTo(arcPoints[k].x, arcPoints[k].y)
        }

        if (root.isError) {
          ctx.strokeStyle = "rgba(239, 68, 68, 0.6)"
          ctx.lineWidth = 1.5
        } else if (root.isActive) {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"
          ctx.lineWidth = 2.0
        } else {
          ctx.strokeStyle = "rgba(255, 255, 255, 0.20)"
          ctx.lineWidth = 1.2
        }
        ctx.stroke()

        // 3. Telemetry Data Packet streaming along the beam
        if (root.isActive && !root.isError) {
          var pIdx = Math.min(segments - 1, Math.floor(root.packetProgress * segments))
          var pkt = arcPoints[pIdx]
          if (pkt && pkt.visible) {
            ctx.fillStyle = "#ffffff"
            ctx.beginPath()
            ctx.arc(pkt.x, pkt.y, 3.2, 0, Math.PI * 2)
            ctx.fill()

            // Trailing glow
            var prevPkt = arcPoints[Math.max(0, pIdx - 2)]
            if (prevPkt) {
              ctx.strokeStyle = "rgba(255, 255, 255, 0.5)"
              ctx.lineWidth = 1.6
              ctx.beginPath()
              ctx.moveTo(pkt.x, pkt.y)
              ctx.lineTo(prevPkt.x, prevPkt.y)
              ctx.stroke()
            }
          }
        }
      }

      // 4. Client Station Badge ("Мой ПК")
      if (pClient.visible) {
        var cAlpha = Math.max(0.3, pClient.z + 0.3)
        var cColor = root.isError ? "rgba(239, 68, 68, " + cAlpha + ")" : (root.isActive ? "rgba(255, 255, 255, " + cAlpha + ")" : "rgba(255, 255, 255, " + (cAlpha * 0.6) + ")")

        ctx.beginPath()
        ctx.arc(pClient.x, pClient.y, 8, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(10, 10, 10, 0.9)"
        ctx.fill()
        ctx.strokeStyle = cColor
        ctx.lineWidth = 1.4
        ctx.stroke()

        ctx.fillStyle = cColor
        ctx.font = "600 11px sans-serif"
        ctx.textAlign = "left"
        ctx.fillText("Мой ПК", pClient.x + 12, pClient.y + 4)
      }

      // 5. Proxy Station Badge ("Прокси")
      if (pProxy.visible) {
        var sAlpha = Math.max(0.3, pProxy.z + 0.3)
        var sColor = root.isError ? "rgba(239, 68, 68, " + sAlpha + ")" : (root.isActive ? "rgba(255, 255, 255, " + sAlpha + ")" : "rgba(255, 255, 255, " + (sAlpha * 0.6) + ")")

        ctx.beginPath()
        ctx.arc(pProxy.x, pProxy.y, 8, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(10, 10, 10, 0.9)"
        ctx.fill()
        ctx.strokeStyle = sColor
        ctx.lineWidth = 1.4
        ctx.stroke()

        ctx.fillStyle = sColor
        ctx.font = "600 11px sans-serif"
        ctx.textAlign = "right"
        ctx.fillText("Прокси", pProxy.x - 12, pProxy.y + 4)
      }
    }
  }

  // Drag-to-rotate interaction
  MouseArea {
    id: dragArea
    anchors.fill: parent
    cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
    property real lastX: 0
    property real lastY: 0

    onPressed: function(mouse) {
      lastX = mouse.x
      lastY = mouse.y
    }

    onPositionChanged: function(mouse) {
      if (pressed) {
        var dx = mouse.x - lastX
        var dy = mouse.y - lastY
        root.rotY += dx * 0.014
        root.rotX = Math.max(-1.1, Math.min(1.1, root.rotX + dy * 0.014))
        lastX = mouse.x
        lastY = mouse.y
        canvas.requestPaint()
      }
    }
  }

  // Smooth continuous auto-rotation
  Timer {
    interval: 20
    running: !dragArea.pressed && canvas.visible
    repeat: true
    onTriggered: {
      root.rotY += 0.005
      root.packetProgress = (root.packetProgress + 0.035) % 1.0
      canvas.requestPaint()
    }
  }
}
