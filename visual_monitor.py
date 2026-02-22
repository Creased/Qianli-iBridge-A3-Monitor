#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Qianli iBridge A3 Visual Monitor
Graphical Interface for live voltage/current visualization.

Features:
- Live Digital Display (Green Voltage / Yellow Current)
- Real-time Scrolling Graph (Red Voltage / White Current)
- Min/Max Statistics
- Power Calculation

Author: @creased
"""

import tkinter as tk
from tkinter import font
from QianliClient import QianliClient
import sys
import time
import collections

class VisualMonitor:
    def __init__(self, root, port):
        self.root = root
        self.root.title("Qianli iBridge Monitor")
        self.root.configure(bg='black')
        self.root.geometry("800x500")
        
        # Connect to Device
        self.client = QianliClient(port)
        if not self.client.connect():
            print(f"Failed to connect to {port}")
            sys.exit(1)
        self.client.ping()
        self.client.request_version()
        time.sleep(0.3)
        self.client.enable_stream()

        
        # Stats Initialization
        self.v_max = 0.0
        self.v_min = 99.0
        self.i_max = 0.0
        self.i_min = 99.0
        self.start_time = time.time()
        
        # Graph Data Storage
        self.max_points = 800
        self.history_v = collections.deque(maxlen=self.max_points)
        self.history_i = collections.deque(maxlen=self.max_points)
        
        # UI Setup
        self.setup_ui()
        
        # Protocol Handlers
        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        
        # Start Update Loop
        self.update_loop()

    def setup_ui(self):
        """Initialize Tkinter widgets and fonts."""
        # Canvas for drawing graphs and text
        self.canvas = tk.Canvas(root, bg='black', highlightthickness=0)
        self.canvas.pack(fill='both', expand=True)
        self.canvas.bind('<Configure>', self.on_resize)
        
        self.width = 800
        self.height = 500

        # Fonts
        self.font_main = font.Font(family="Consolas", size=90, weight="bold")
        self.font_unit = font.Font(family="Consolas", size=40, weight="normal")
        self.font_stats = font.Font(family="Consolas", size=24, weight="bold")

    def on_resize(self, event):
        """Handle window resize events."""
        self.width = event.width
        self.height = event.height
        # self.max_points could be adjusted here if needed

    def scale_y(self, value, min_val, max_val, height, padding=20):
        """Map a value to Y pixel coordinate within the given range."""
        if max_val == min_val:
            return height / 2
        # Invert Y (0 is top)
        norm = (value - min_val) / (max_val - min_val)
        return height - padding - (norm * (height - 2 * padding))

    def update_loop(self):
        """Main update loop: fetch data, update stats, redraw GUI."""
        v, i, t = self.client.get_latest_reading()
        
        # Update Stats (ignore first reading/startup glitches)
        if t > self.start_time:
             self.v_max = max(self.v_max, v)
             self.v_min = min(self.v_min, v)
             self.i_max = max(self.i_max, i)
             self.i_min = min(self.i_min, i)

        # Update History
        self.history_v.append(v)
        self.history_i.append(i)

        # Redraw Canvas
        self.canvas.delete("all")
        self.draw_graphs()
        self.draw_text_overlay(v, i)
        
        # Schedule next update (50ms = 20 FPS)
        self.root.after(50, self.update_loop)

    def draw_graphs(self):
        """Draw voltage and current graphs on the canvas."""
        # Voltage Graph (Red)
        if len(self.history_v) > 1:
            max_v_hist = max(self.history_v)
            top_v = max(max_v_hist * 1.1, 5.0) # Scale: 0 to Max*1.1 (Min 5V)
            
            points_v = []
            for idx, val in enumerate(self.history_v):
                x = self.width - (len(self.history_v) - 1 - idx) * 2
                y = self.scale_y(val, 0, top_v, self.height)
                points_v.append(x)
                points_v.append(y)
            
            self.canvas.create_line(points_v, fill="red", width=2, smooth=True, tag="graph")

        # Current Graph (White)
        if len(self.history_i) > 1:
            max_i_hist = max(self.history_i)
            top_i = max(max_i_hist * 1.1, 1.0) # Scale: 0 to Max*1.1 (Min 1A)
            
            points_i = []
            for idx, val in enumerate(self.history_i):
                x = self.width - (len(self.history_i) - 1 - idx) * 2
                y = self.scale_y(val, 0, top_i, self.height)
                points_i.append(x)
                points_i.append(y)
            
            self.canvas.create_line(points_i, fill="white", width=2, smooth=True, tag="graph")

    def draw_text_overlay(self, v, i):
        """Draw digital values and statistics."""
        # Voltage (Top Left)
        self.canvas.create_text(20, 80, text=f"{v:.3f}", font=self.font_main, fill="#00FF00", anchor='w')
        self.canvas.create_text(450, 100, text="V", font=self.font_unit, fill="#00FF00", anchor='w')
        
        # Stats V (Top Right)
        stats_v = f"Max: {self.v_max:.3f}\nMin: {self.v_min:.3f}"
        self.canvas.create_text(self.width - 20, 60, text=stats_v, font=self.font_stats, fill="#008800", anchor='e')

        # Current (Middle Left)
        self.canvas.create_text(20, 230, text=f"{i:.3f}", font=self.font_main, fill="#FFFF00", anchor='w')
        self.canvas.create_text(450, 250, text="A", font=self.font_unit, fill="#FFFF00", anchor='w')
        
        # Stats I (Middle Right)
        stats_i = f"Max: {self.i_max:.3f}\nMin: {self.i_min:.3f}"
        self.canvas.create_text(self.width - 20, 210, text=stats_i, font=self.font_stats, fill="#888800", anchor='e')

        # Power (Bottom Left)
        power_w = v * i
        self.canvas.create_text(20, 380, text=f"{power_w:.3f}", font=self.font_main, fill="#888888", anchor='w')
        self.canvas.create_text(450, 400, text="W", font=self.font_unit, fill="#888888", anchor='w')

    def on_close(self):
        """Handle cleanup on exit."""
        print("Closing...")
        self.client.disable_stream()
        self.client.disconnect()
        self.root.destroy()

if __name__ == "__main__":
    port = "COM5" 
    if len(sys.argv) > 1:
        port = sys.argv[1]
    
    root = tk.Tk()
    app = VisualMonitor(root, port)
    root.mainloop()
