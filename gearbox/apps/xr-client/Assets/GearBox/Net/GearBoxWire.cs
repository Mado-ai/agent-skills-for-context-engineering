// Hand-written companion to Generated/GearBoxProtocol.g.cs.
//
// The generated file contains the message structs and the routing tables; this file
// contains the primitive reader/writer they call into. Keeping the primitives here
// means the codegen output stays purely declarative, and it mirrors
// packages/protocol/src/quantize.ts exactly — the two must agree bit for bit.
//
// Any change to quantization must be made in BOTH places and covered by the
// cross-language vector test (tools/protocol-codegen).

using System;
using UnityEngine;

namespace GearBox.Generated
{
    /// <summary>Session bounds used to quantize positions. Mirrors Bounds in quantize.ts.</summary>
    public struct SessionBounds
    {
        public Vector3 Min;
        public Vector3 Max;

        /// <summary>A 64 m cube centred on the anchor — roughly 1 mm precision.</summary>
        public static SessionBounds Default => new SessionBounds
        {
            Min = new Vector3(-32f, -8f, -32f),
            Max = new Vector3(32f, 24f, 32f),
        };
    }

    internal static class Quantize
    {
        internal const int U16Max = 65535;
        internal const int TenBits = 1023;
        internal static readonly float Sqrt2Inv = 1f / Mathf.Sqrt(2f);

        internal static ushort Axis(float value, float min, float max)
        {
            float span = max - min;
            if (span <= 0f) return 0;
            float t = Mathf.Clamp01((value - min) / span);
            return (ushort)Mathf.RoundToInt(t * U16Max);
        }

        internal static float Dequantize(ushort q, float min, float max)
        {
            return min + (q / (float)U16Max) * (max - min);
        }

        /// <summary>Smallest-three quaternion packing. Mirrors packQuat() in quantize.ts.</summary>
        internal static uint PackQuaternion(Quaternion q)
        {
            float len = Mathf.Sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w);
            if (len <= 0f) { q = Quaternion.identity; }
            else { q = new Quaternion(q.x / len, q.y / len, q.z / len, q.w / len); }

            var comps = new[] { q.x, q.y, q.z, q.w };
            int maxIdx = 0;
            float maxAbs = Mathf.Abs(comps[0]);
            for (int i = 1; i < 4; i++)
            {
                float a = Mathf.Abs(comps[i]);
                if (a > maxAbs) { maxAbs = a; maxIdx = i; }
            }

            // q and -q are the same rotation; normalise the sign so the dropped
            // component can always be reconstructed as positive.
            float sign = comps[maxIdx] < 0f ? -1f : 1f;

            var rest = new float[3];
            int j = 0;
            for (int i = 0; i < 4; i++)
            {
                if (i == maxIdx) continue;
                rest[j++] = comps[i] * sign;
            }

            uint packed = (uint)(maxIdx & 0x3) * 0x40000000u;
            for (int i = 0; i < 3; i++)
            {
                float t = Mathf.Clamp01((rest[i] + Sqrt2Inv) / (2f * Sqrt2Inv));
                uint enc = (uint)Mathf.RoundToInt(t * TenBits);
                packed += enc << (20 - i * 10);
            }
            return packed;
        }

        internal static Quaternion UnpackQuaternion(uint packed)
        {
            int maxIdx = (int)((packed / 0x40000000u) & 0x3u);
            var dec = new float[3];
            for (int i = 0; i < 3; i++)
            {
                uint enc = (packed >> (20 - i * 10)) & TenBits;
                dec[i] = (enc / (float)TenBits) * (2f * Sqrt2Inv) - Sqrt2Inv;
            }

            float sumSq = dec[0] * dec[0] + dec[1] * dec[1] + dec[2] * dec[2];
            float largest = Mathf.Sqrt(Mathf.Max(0f, 1f - sumSq));

            var outv = new float[4];
            outv[maxIdx] = largest;
            int j = 0;
            for (int i = 0; i < 4; i++)
            {
                if (i == maxIdx) continue;
                outv[i] = dec[j++];
            }
            return new Quaternion(outv[0], outv[1], outv[2], outv[3]);
        }
    }

    /// <summary>Little-endian writer. Allocation-free: callers supply the buffer.</summary>
    public sealed class GearBoxWriter
    {
        private readonly byte[] _buffer;
        private int _offset;

        public GearBoxWriter(byte[] buffer) { _buffer = buffer; _offset = 0; }

        public int Length => _offset;
        public void Reset() => _offset = 0;

        public void Write(byte v) => _buffer[_offset++] = v;

        public void Write(ushort v)
        {
            _buffer[_offset++] = (byte)(v & 0xFF);
            _buffer[_offset++] = (byte)((v >> 8) & 0xFF);
        }

        public void Write(short v) => Write(unchecked((ushort)v));

        public void Write(uint v)
        {
            _buffer[_offset++] = (byte)(v & 0xFF);
            _buffer[_offset++] = (byte)((v >> 8) & 0xFF);
            _buffer[_offset++] = (byte)((v >> 16) & 0xFF);
            _buffer[_offset++] = (byte)((v >> 24) & 0xFF);
        }

        public void Write(float v)
        {
            var bytes = BitConverter.GetBytes(v);
            if (!BitConverter.IsLittleEndian) Array.Reverse(bytes);
            Buffer.BlockCopy(bytes, 0, _buffer, _offset, 4);
            _offset += 4;
        }

        public void WriteQuantizedVector3(Vector3 v, in SessionBounds b)
        {
            Write(Quantize.Axis(v.x, b.Min.x, b.Max.x));
            Write(Quantize.Axis(v.y, b.Min.y, b.Max.y));
            Write(Quantize.Axis(v.z, b.Min.z, b.Max.z));
        }

        public void WritePackedQuaternion(Quaternion q) => Write(Quantize.PackQuaternion(q));

        /// <summary>Writes the 4-byte header defined in docs/gearbox/05-realtime.md §5.4.</summary>
        public void WriteHeader(MessageId id, int payloadLength)
        {
            Write(Protocol.Version);
            Write((byte)id);
            Write((ushort)payloadLength);
        }
    }

    /// <summary>Little-endian reader over a received datagram.</summary>
    public sealed class GearBoxReader
    {
        private readonly byte[] _buffer;
        private int _offset;

        public GearBoxReader(byte[] buffer, int offset = 0) { _buffer = buffer; _offset = offset; }

        public int Offset => _offset;
        public int Remaining => _buffer.Length - _offset;

        public byte ReadByte() => _buffer[_offset++];

        public ushort ReadUInt16()
        {
            ushort v = (ushort)(_buffer[_offset] | (_buffer[_offset + 1] << 8));
            _offset += 2;
            return v;
        }

        public short ReadInt16() => unchecked((short)ReadUInt16());

        public uint ReadUInt32()
        {
            uint v = (uint)(_buffer[_offset]
                | (_buffer[_offset + 1] << 8)
                | (_buffer[_offset + 2] << 16)
                | (_buffer[_offset + 3] << 24));
            _offset += 4;
            return v;
        }

        public float ReadSingle()
        {
            float v = BitConverter.ToSingle(_buffer, _offset);
            _offset += 4;
            return v;
        }

        public Vector3 ReadQuantizedVector3(in SessionBounds b)
        {
            float x = Quantize.Dequantize(ReadUInt16(), b.Min.x, b.Max.x);
            float y = Quantize.Dequantize(ReadUInt16(), b.Min.y, b.Max.y);
            float z = Quantize.Dequantize(ReadUInt16(), b.Min.z, b.Max.z);
            return new Vector3(x, y, z);
        }

        public Quaternion ReadPackedQuaternion() => Quantize.UnpackQuaternion(ReadUInt32());

        /// <summary>
        /// Reads and validates the header. Returns false on a version mismatch or a
        /// declared length that disagrees with the schema — a client must never
        /// silently continue past either, because that is how desyncs become invisible.
        /// </summary>
        public bool TryReadHeader(out MessageId id, out int payloadLength)
        {
            id = default;
            payloadLength = 0;
            if (Remaining < Protocol.HeaderSize) return false;

            byte version = ReadByte();
            if (version != Protocol.Version) return false;

            id = (MessageId)ReadByte();
            payloadLength = ReadUInt16();

            int expected = MessageRouting.PayloadSize(id);
            if (expected < 0 || expected != payloadLength) return false;
            return Remaining >= payloadLength;
        }
    }
}
