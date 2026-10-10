from PIL import Image, ImageDraw

def create_tray_icon(src_path, dst_path, size, dot_color, stroke_color=(13, 13, 13, 255)):
    # Load base image
    base = Image.open(src_path).convert("RGBA")
    if base.size != (size, size):
        base = base.resize((size, size), Image.Resampling.LANCZOS)
    
    # 4x supersampling for ultra-crisp anti-aliasing
    scale = 4
    high_res_size = size * scale
    overlay = Image.new("RGBA", (high_res_size, high_res_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # Dot positioning: bottom-right quadrant
    # For size=32: cx=24, cy=24, outer_r=6.5, inner_r=4.8
    # For size=128: cx=98, cy=98, outer_r=26, inner_r=19.5
    cx = int(size * 0.77 * scale)
    cy = int(size * 0.77 * scale)
    outer_r = int(size * 0.19 * scale)
    inner_r = int(size * 0.14 * scale)
    
    # Outer dark stroke
    draw.ellipse([cx - outer_r, cy - outer_r, cx + outer_r, cy + outer_r], fill=stroke_color)
    # Inner colored dot
    draw.ellipse([cx - inner_r, cy - inner_r, cx + inner_r, cy + inner_r], fill=dot_color)
    
    # Downscale overlay
    overlay = overlay.resize((size, size), Image.Resampling.LANCZOS)
    
    # Composite
    final_img = Image.alpha_composite(base, overlay)
    final_img.save(dst_path, "PNG")
    print(f"Generated {dst_path} ({size}x{size})")

green = (34, 197, 94, 255)  # #22c55e
red = (239, 68, 68, 255)     # #ef4444

icons_dir = r"proxy-router-desktop\src-tauri\icons"
src_32 = f"{icons_dir}\\32x32.png"
src_128 = f"{icons_dir}\\128x128.png"

create_tray_icon(src_32, f"{icons_dir}\\tray-active.png", 32, green)
create_tray_icon(src_32, f"{icons_dir}\\tray-inactive.png", 32, red)

create_tray_icon(src_128, f"{icons_dir}\\tray-active-128.png", 128, green)
create_tray_icon(src_128, f"{icons_dir}\\tray-inactive-128.png", 128, red)
