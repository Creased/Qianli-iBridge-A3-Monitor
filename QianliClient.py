#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Qianli iBridge A3 Client Library
Reverse-engineered protocol implementation for the Qianli iBridge A3 USB Tester.

Author: @creased
"""

import serial
import struct
import time
import threading
import queue

class QianliClient:
    MAGIC_BYTE = 0xDA

    def __init__(self, port, baud_rate=115200):
        self.port = port
        self.baud_rate = baud_rate
        self.ser = None
        self.running = False
        self.rx_thread = None
        self.data_queue = queue.Queue(maxsize=100) # Store latest reading
        self._buffer = bytearray()
        
        # Latest values
        self.voltage_v = 0.0
        self.current_a = 0.0
        self.last_update = 0

    def connect(self):
        """Establish serial connection to the device."""
        try:
            self.ser = serial.Serial(self.port, self.baud_rate, timeout=1)
            self.ser.reset_input_buffer()
            self.ser.reset_output_buffer()
            self.running = True
            
            # Start RX Thread
            self.rx_thread = threading.Thread(target=self._rx_loop, daemon=True)
            self.rx_thread.start()
            
            print(f"[Qianli] Connected to {self.port}")
            return True
        except Exception as e:
            print(f"[Qianli] Connection Failed: {e}")
            return False

    def disconnect(self):
        """Close the serial connection cleanly."""
        self.running = False
        if self.rx_thread:
            self.rx_thread.join(timeout=1)
        if self.ser and self.ser.is_open:
            self.ser.close()
        print("[Qianli] Disconnected")

    def enable_stream(self):
        """Send Cmd 04 05 Payload 00 to enable binary data stream."""
        print("[Qianli] Enabling Data Stream...")
        pkt = self._build_packet(0x04, 0x05, payload=b'\x00')
        self.ser.write(pkt)

    def disable_stream(self):
        """Send Cmd 04 05 Payload 01 to disable binary data stream."""
        print("[Qianli] Disabling Data Stream...")
        pkt = self._build_packet(0x04, 0x05, payload=b'\x01')
        self.ser.write(pkt)

    def get_latest_reading(self):
        """Return (Voltage_V, Current_A, Timestamp)."""
        return self.voltage_v, self.current_a, self.last_update

    def _calc_checksum(self, data):
        """Calculate XOR checksum of data bytes."""
        cs = data[0]
        for b in data[1:]:
            cs ^= b
        return cs

    def _build_packet(self, model, cmd, params=b'\x00\x00', payload=b''):
        """Construct a protocol packet with correct checksum."""
        if not payload:
            payload = b'\x00' # Firmware requires length > 0
            
        length = len(payload)
        header = bytearray([self.MAGIC_BYTE])
        header.extend(struct.pack("<H", length)) # 2 bytes length (Little Endian)
        header.append(model)
        header.append(cmd)
        header.extend(params)
        
        # Payload Checksum (XOR of Payload, not Header)
        if len(payload) > 0:
            cs = self._calc_checksum(payload)
        else:
            cs = 0
        header.append(cs)
        
        # Full Packet
        packet = header + payload
        return packet

    def _rx_loop(self):
        """Background thread to handle incoming serial data."""
        while self.running and self.ser.is_open:
            try:
                if self.ser.in_waiting > 0:
                    chunk = self.ser.read(self.ser.in_waiting)
                    self._buffer.extend(chunk)
                    self._parse_buffer()
                else:
                    time.sleep(0.01)
            except Exception as e:
                print(f"[RX Error] {e}")
                break

    def _parse_buffer(self):
        """Parse packets from the receive buffer."""
        while len(self._buffer) >= 8:
            # Check for Magic Byte
            if self._buffer[0] != self.MAGIC_BYTE:
                self._buffer.pop(0)
                continue
                
            # Parse Header
            try:
                length = struct.unpack("<H", self._buffer[1:3])[0]
                total_len = 8 + length
                
                if len(self._buffer) < total_len:
                    return # Wait for more data
                
                packet = self._buffer[:total_len]
                
                # Verify Checksum
                header_cs = packet[7]
                
                # Checksum is XOR of Payload bytes
                payload_data = packet[8:]
                if len(payload_data) > 0:
                     calc_cs = self._calc_checksum(payload_data)
                else:
                     calc_cs = 0
                
                if header_cs == calc_cs:
                    # Valid Packet
                    model = packet[3]
                    cmd = packet[4]
                    payload = packet[8:]
                    self._handle_packet(model, cmd, payload)
                    
                    # Remove from buffer
                    del self._buffer[:total_len]
                else:
                    # Invalid CS, drop 1 byte and retry
                     self._buffer.pop(0)
                     
            except Exception:
                # Malformed, drop byte
                self._buffer.pop(0)

    def _handle_packet(self, model, cmd, payload):
        """Process valid packets."""
        # Decode Stream Data (Model 04, Cmd 05, Len 8)
        if model == 0x04 and cmd == 0x05 and len(payload) == 8:
            try:
                # Payload: [Current 10k] [Voltage 1k] (Big Endian)
                val1, val2 = struct.unpack(">II", payload)
                
                # Scaling:
                # Current (A): val1 / 10000.0
                # Voltage (V): val2 / 1000.0
                
                self.current_a = val1 / 10000.0
                self.voltage_v = val2 / 1000.0
                self.last_update = time.time()
                
            except Exception as e:
                print(f"[Decode Error] {e}")

if __name__ == "__main__":
    # Example Usage
    import sys
    port = "COM5" 
    if len(sys.argv) > 1:
        port = sys.argv[1]
        
    client = QianliClient(port)
    if client.connect():
        client.enable_stream()
        print("Monitoring... Press Ctrl+C to stop")
        try:
            while True:
                v, i, t = client.get_latest_reading()
                print(f"\rVoltage: {v:.3f} V  |  Current: {i:.3f} A   ", end="")
                time.sleep(0.1)
        except KeyboardInterrupt:
            print("\nStopping...")
            client.disable_stream()
            client.disconnect()
