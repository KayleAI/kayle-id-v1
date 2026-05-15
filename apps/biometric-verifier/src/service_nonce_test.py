"""Tests for the liveness challenge nonce extract path.

Covers synthetic-frame round-trip, mismatch detection, shape
validation, majority vote, and an end-to-end pass through
`cv2.VideoWriter` so we exercise the same decode codepath the
container hits in production.
"""

import os
import tempfile
import unittest

import cv2
import numpy as np

from service import (
    NONCE_BYTES,
    NONCE_COLS,
    NONCE_EXPECTED_HEIGHT,
    NONCE_EXPECTED_WIDTH,
    NONCE_GUTTER,
    NONCE_PATCH_X,
    NONCE_PATCH_Y,
    NONCE_ROWS,
    NONCE_SQUARE_SIZE,
    extract_frames_with_ffmpeg,
    extract_nonce_from_frame,
    verify_challenge_nonce,
)


def _blank_frame() -> np.ndarray:
    return np.zeros(
        (NONCE_EXPECTED_HEIGHT, NONCE_EXPECTED_WIDTH, 3), dtype=np.uint8
    )


def _stamp(frame: np.ndarray, nonce: bytes) -> np.ndarray:
    """Mirror the iOS stamp: 32 BGR squares at the agreed coordinates."""
    if len(nonce) != NONCE_BYTES:
        raise ValueError("nonce_wrong_length")
    pitch = NONCE_SQUARE_SIZE + NONCE_GUTTER
    for bit_index in range(NONCE_BYTES * 8):
        col = bit_index % NONCE_COLS
        row = bit_index // NONCE_COLS
        byte_index = bit_index // 8
        bit_in_byte = 7 - (bit_index % 8)
        bit = (nonce[byte_index] >> bit_in_byte) & 1
        value = 255 if bit == 1 else 0
        x0 = NONCE_PATCH_X + col * pitch
        y0 = NONCE_PATCH_Y + row * pitch
        frame[y0 : y0 + NONCE_SQUARE_SIZE, x0 : x0 + NONCE_SQUARE_SIZE, :] = (
            value
        )
    return frame


class ExtractNonceTests(unittest.TestCase):
    def test_round_trip_arbitrary_nonce(self) -> None:
        nonce = bytes([0xA5, 0x3C, 0xF0, 0x07])
        frame = _stamp(_blank_frame(), nonce)
        self.assertEqual(extract_nonce_from_frame(frame), nonce)

    def test_round_trip_all_zero(self) -> None:
        nonce = bytes(4)
        frame = _stamp(_blank_frame(), nonce)
        self.assertEqual(extract_nonce_from_frame(frame), nonce)

    def test_round_trip_all_ones(self) -> None:
        nonce = bytes([0xFF, 0xFF, 0xFF, 0xFF])
        frame = _stamp(_blank_frame(), nonce)
        self.assertEqual(extract_nonce_from_frame(frame), nonce)

    def test_round_trip_alternating(self) -> None:
        nonce = bytes([0xAA, 0x55, 0xAA, 0x55])
        frame = _stamp(_blank_frame(), nonce)
        self.assertEqual(extract_nonce_from_frame(frame), nonce)

    def test_mismatch_between_stamped_and_expected(self) -> None:
        stamped = bytes([0x12, 0x34, 0x56, 0x78])
        other = bytes([0x12, 0x34, 0x56, 0x79])
        frame = _stamp(_blank_frame(), stamped)
        self.assertEqual(extract_nonce_from_frame(frame), stamped)
        self.assertNotEqual(extract_nonce_from_frame(frame), other)

    def test_returns_none_on_wrong_shape(self) -> None:
        smaller = np.zeros((640, 480, 3), dtype=np.uint8)
        self.assertIsNone(extract_nonce_from_frame(smaller))

    def test_returns_none_on_wrong_channel_count(self) -> None:
        gray = np.zeros(
            (NONCE_EXPECTED_HEIGHT, NONCE_EXPECTED_WIDTH), dtype=np.uint8
        )
        self.assertIsNone(extract_nonce_from_frame(gray))


class VerifyChallengeNonceTests(unittest.TestCase):
    def test_strict_majority_match_passes(self) -> None:
        nonce = bytes([0xDE, 0xAD, 0xBE, 0xEF])
        clean = [_stamp(_blank_frame(), nonce) for _ in range(20)]
        # Four frames with the wrong nonce — still a strict majority
        # of correct frames (16 / 20).
        corrupted = [
            _stamp(_blank_frame(), bytes([0, 0, 0, 0])) for _ in range(4)
        ]
        result = verify_challenge_nonce(clean + corrupted, nonce)
        self.assertTrue(result.matched)
        self.assertEqual(result.frames_total, 24)
        self.assertEqual(result.frames_decoded, 24)
        self.assertEqual(result.frames_matched, 20)

    def test_tie_rejects(self) -> None:
        nonce = bytes([0x01, 0x02, 0x03, 0x04])
        good = [_stamp(_blank_frame(), nonce) for _ in range(12)]
        bad = [
            _stamp(_blank_frame(), bytes([0xFF, 0xFF, 0xFF, 0xFF]))
            for _ in range(12)
        ]
        result = verify_challenge_nonce(good + bad, nonce)
        # 12 matches out of 24 isn't a STRICT majority.
        self.assertFalse(result.matched)
        self.assertEqual(result.frames_matched, 12)

    def test_no_matches_rejects(self) -> None:
        nonce = bytes([0x11, 0x22, 0x33, 0x44])
        decoy = [
            _stamp(_blank_frame(), bytes([0xAA, 0xBB, 0xCC, 0xDD]))
            for _ in range(24)
        ]
        result = verify_challenge_nonce(decoy, nonce)
        self.assertFalse(result.matched)
        self.assertEqual(result.frames_matched, 0)
        self.assertEqual(result.frames_decoded, 24)

    def test_undecodable_frames_count_against_majority(self) -> None:
        nonce = bytes([0x11, 0x22, 0x33, 0x44])
        good = [_stamp(_blank_frame(), nonce) for _ in range(10)]
        garbage = [np.zeros((640, 480, 3), dtype=np.uint8) for _ in range(14)]
        result = verify_challenge_nonce(good + garbage, nonce)
        # 10 matches out of 24 total frames isn't a majority even
        # though every decoded frame matched.
        self.assertFalse(result.matched)
        self.assertEqual(result.frames_decoded, 10)
        self.assertEqual(result.frames_matched, 10)


def _write_test_mp4(frames: list[np.ndarray]) -> bytes:
    """Encode frames through cv2.VideoWriter and return the raw bytes."""
    fd, path = tempfile.mkstemp(suffix=".mp4")
    os.close(fd)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(
        path,
        fourcc,
        24.0,
        (NONCE_EXPECTED_WIDTH, NONCE_EXPECTED_HEIGHT),
    )
    try:
        if not writer.isOpened():
            raise unittest.SkipTest("cv2.VideoWriter mp4v codec unavailable")
        for frame in frames:
            writer.write(frame)
    finally:
        writer.release()
    try:
        with open(path, "rb") as f:
            return f.read()
    finally:
        os.unlink(path)


class EncodedRoundTripTests(unittest.TestCase):
    def test_majority_vote_survives_mp4_encode_decode(self) -> None:
        nonce = bytes([0xC0, 0xFF, 0xEE, 0x42])
        frames = [_stamp(_blank_frame(), nonce) for _ in range(24)]
        try:
            video_bytes = _write_test_mp4(frames)
        except unittest.SkipTest as skip:
            self.skipTest(str(skip))

        decoded_frames, duration = extract_frames_with_ffmpeg(
            video_bytes, 24
        )
        self.assertGreater(len(decoded_frames), 0)
        self.assertIsNotNone(duration)
        result = verify_challenge_nonce(decoded_frames, nonce)
        self.assertTrue(
            result.matched,
            f"majority vote should survive mp4v round trip "
            f"(matched={result.frames_matched}/{result.frames_total}, "
            f"decoded={result.frames_decoded})",
        )

    def test_round_trip_rejects_wrong_nonce(self) -> None:
        stamped = bytes([0xC0, 0xFF, 0xEE, 0x42])
        attacker_nonce = bytes([0xDE, 0xAD, 0xBE, 0xEF])
        frames = [_stamp(_blank_frame(), stamped) for _ in range(24)]
        try:
            video_bytes = _write_test_mp4(frames)
        except unittest.SkipTest as skip:
            self.skipTest(str(skip))

        decoded_frames, _ = extract_frames_with_ffmpeg(video_bytes, 24)
        result = verify_challenge_nonce(decoded_frames, attacker_nonce)
        self.assertFalse(result.matched)


if __name__ == "__main__":
    unittest.main()
