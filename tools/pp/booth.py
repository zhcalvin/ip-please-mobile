"""检查亭场景。

用法：先用 Case 的方法按顺序“写剧本”（叫号、进场、说话、递证件、检查、盖章、离开……），
每个方法会自动推进内部时间并记录鼠标路径和音效；渲染时 frame(t) 按时间轴还原画面。
"""
import math
import random
from functools import lru_cache

from PIL import Image, ImageDraw

from . import audio as au
from . import cast
from .base import (BANNER, BOOK, BOOK_L, BOOTH_LOW, BOOTH_WALL, CLAUDE, CLAUDE_L, COUNTER, COUNTER_D, COUNTER_L,
                   DESK, DESK_D, DESK_L, FLAG_W, FRAME_D, GOLD, GREEN, GREEN_D, GREY, GROUND, GROUND_D, GROUND_L,
                   H, HAIR, INK, LED, METAL, METAL_D, METAL_L, OUTLINE, RED, RED_D, RED_L, ROAD, ROAD_L, TEXT, W,
                   WALL, WALL_D, WALL_L, WHITE, WIN_GROUND, WIN_WALL, XRAY_BG, XRAY_FG, XRAY_L, darken, draw,
                   draw_cursor, edge_point, ease_out, lerp, lerp2, pattern, seg, smooth, spark, tw, txt)
from .docs import Card, CrayonPassport, Passport, PromptPaper, small_icon, stamp_mark

WIN = (8, 134, 210, 262)
WIN_W, WIN_H = WIN[2] - WIN[0] + 1, WIN[3] - WIN[1] + 1
WIN_CX = 101
SPEAKER = (15, 298)
DETAIN_BTN = (172, 268, 212, 280)
INSPECT_BTN = (602, 322, 634, 354)
XRAY_BTN = (566, 322, 598, 354)
ASK_BTN = (548, 140, 590, 162)
BANNER_BOX = (300, 134, 598, 168)
TRAY_Y0, TRAY_Y1, TRAY_W = 196, 252, 170
TRAY_X = W - TRAY_W
STAMP_BTN = {"approve": (TRAY_X + 42, 226), "deny": (TRAY_X + 122, 226)}
MARK_XY = {"approve": (483, 220), "deny": (562, 220)}
SLOT_PASSPORT = (446, 172)
PRINT_X = 240
BOOTH_POS = (312, 117)
QUEUE_FRONT = (292, 102)
BANNER1_X = 70


def center(box):
    return ((box[0] + box[2]) // 2, (box[1] + box[3]) // 2)


# ———————————————————— 静态背景 ————————————————————

def tiny_person(d, x, y, coat, hat=None, step=0, skin=(198, 152, 120), back=False):
    """(x, y) 为脚底中心。"""
    d.line([x - 3, y + 1, x + 3, y + 1], fill=GROUND_D)
    d.rectangle([x - 2, y - 3, x - 1, y - (1 if step else 0)], fill=OUTLINE)
    d.rectangle([x + 1, y - 3, x + 2, y - (0 if step else 1)], fill=OUTLINE)
    d.rectangle([x - 2, y - 8, x + 2, y - 4], fill=coat)
    d.rectangle([x - 1, y - 11, x + 1, y - 9], fill=hat if back and hat else skin)
    if hat:
        d.rectangle([x - 1, y - 11, x + 1, y - 11], fill=hat)


def guard_tiny(d, x, y):
    tiny_person(d, x, y, (70, 78, 60), hat=(40, 46, 36))
    d.line([x + 3, y - 10, x + 3, y - 3], fill=INK)


def banner(d, x, y, s, size=10, fg=(214, 196, 170)):
    w = tw(s, size) + 10
    d.rectangle([x, y, x + w, y + 15], fill=BANNER)
    d.rectangle([x, y, x + w, y], fill=(140, 58, 50))
    txt(d, (x + 5, y + 3), s, size, fg)


COATS = [(74, 70, 60), (90, 72, 60), (60, 64, 72), (98, 92, 80), (70, 56, 52), (84, 84, 76), (110, 96, 74)]


def draw_exterior(img, lang="zh"):
    d = draw(img)
    en = lang == "en"
    rng = random.Random(3)
    d.rectangle([0, 0, W - 1, 123], fill=GROUND)
    for _ in range(900):
        d.point((rng.randrange(W), rng.randrange(42, 124)), fill=rng.choice([GROUND_D, GROUND_D, GROUND_L]))
    d.rectangle([0, 4, W - 1, 40], fill=WALL)
    d.rectangle([0, 4, W - 1, 6], fill=WALL_L)
    d.rectangle([0, 38, W - 1, 40], fill=WALL_D)
    for x in range(12, W, 26):
        d.line([x, 7, x, 37], fill=WALL_D)
    d.rectangle([0, 41, W - 1, 42], fill=GROUND_D)
    banner(d, BANNER1_X, 13, "HELPFUL · HONEST · HARMLESS")
    banner(d, 392, 13, "GLORY TO ANTHROTZKA" if en else "荣耀归于 ANTHROTZKA")
    d.ellipse([318, 9, 344, 35], fill=WALL_D)
    d.ellipse([320, 11, 342, 33], fill=(70, 50, 44))
    spark(d, 331, 22, CLAUDE)
    d.rectangle([362, 100, W - 1, 123], fill=ROAD)
    for x in range(370, W, 14):
        d.line([x, 111, x + 6, 111], fill=ROAD_L)
    for px in (440, 500):
        d.rectangle([px, 62, px + 1, 76], fill=OUTLINE)
    sx0, sx1 = (422, 518) if en else (428, 512)
    d.rectangle([sx0, 50, sx1, 64], fill=(196, 184, 160))
    d.rectangle([sx0, 64, sx1, 65], fill=OUTLINE)
    txt(d, (470, 52), "SUPPORTED ONLY" if en else "仅限支持地区", 10, TEXT, anchor="ma")
    for lx in (598, 624):
        d.line([lx, 30, lx, 96], fill=WALL_D, width=2)
    d.line([598, 60, 624, 90], fill=WALL_D)
    d.line([624, 60, 598, 90], fill=WALL_D)
    d.rectangle([590, 14, 632, 17], fill=INK)
    d.rectangle([592, 18, 630, 32], fill=WALL_L)
    d.rectangle([596, 22, 626, 26], fill=(40, 38, 36))
    tiny_person(d, 611, 22, (70, 78, 60), hat=(40, 46, 36))
    d.line([360, 43, 360, 96], fill=METAL_D)
    d.line([361, 43, 361, 96], fill=METAL_L)
    for y in range(46, 96, 8):
        d.line([358, y, 363, y], fill=METAL_D)
    d.rectangle([358, 96, 363, 99], fill=INK)
    for i, y in enumerate(range(100, 122, 3)):
        d.rectangle([360, y, 361, y + 2], fill=RED if i % 2 == 0 else FLAG_W)
    d.rectangle([315, 82, 355, 86], fill=WALL_D)
    d.rectangle([318, 87, 352, 116], fill=(120, 116, 106))
    d.rectangle([318, 113, 352, 116], fill=(96, 92, 84))
    d.rectangle([322, 92, 334, 102], fill=(176, 160, 110))
    d.rectangle([339, 92, 348, 112], fill=(84, 80, 74))
    guard_tiny(d, 372, 98)
    guard_tiny(d, 384, 72)
    for y, x0, x1 in ((58, 16, 296), (74, 16, 272), (90, 40, 296), (106, 16, 296)):
        d.line([x0, y, x1, y], fill=METAL_L)
        d.line([x0, y + 1, x1, y + 1], fill=METAL_D)
        for px in range(x0, x1 + 1, 20):
            d.line([px, y - 3, px, y + 1], fill=METAL_D)
    for lane_y in (70, 86, 102):
        x = 26
        while x < (284 if lane_y == 102 else 288):
            if rng.random() < 0.72:
                tiny_person(d, x + rng.randint(-1, 1), lane_y + rng.randint(-1, 1), rng.choice(COATS),
                            hat=rng.choice([None, None, HAIR, (90, 40, 36)]))
            x += rng.randint(9, 13)


def draw_booth_static(img):
    d = draw(img)
    d.rectangle([0, 124, W - 1, 127], fill=INK)
    d.rectangle([0, 128, 218, H - 1], fill=BOOTH_WALL)
    d.rectangle([WIN[0] - 2, WIN[1] - 2, WIN[2] + 2, WIN[3] + 2], fill=FRAME_D)
    d.rectangle([0, 262, 218, 266], fill=COUNTER_L)
    d.rectangle([0, 267, 218, 281], fill=COUNTER)
    d.rectangle([0, 282, 218, 283], fill=COUNTER_D)
    d.rectangle([0, 284, 218, H - 1], fill=BOOTH_LOW)
    for y in (300, 320, 340):
        d.line([0, y, 218, y], fill=(38, 35, 32))
    d.rectangle([216, 128, 219, H - 1], fill=INK)


def draw_desk_static(img, lang="zh"):
    d = draw(img)
    rng = random.Random(5)
    d.rectangle([220, 128, W - 1, H - 1], fill=DESK)
    y = 133
    while y < H:
        x = 220
        while x < W:
            seglen = rng.randint(20, 90)
            if rng.random() < 0.7:
                d.line([x, y, min(W - 1, x + seglen), y], fill=DESK_D)
            x += seglen + rng.randint(4, 30)
        y += rng.randint(5, 10)
    d.rectangle([220, 128, W - 1, 131], fill=DESK_L)
    d.rectangle([PRINT_X - 4, 128, PRINT_X + 132, 130], fill=INK)
    # 规则书（Claude 章程）
    bx, by = 500, 306
    d.rectangle([bx + 2, by + 2, bx + 58, H - 1], fill=DESK_D)
    d.rectangle([bx, by, bx + 56, H - 1], fill=BOOK)
    d.rectangle([bx, by, bx + 4, H - 1], fill=(70, 48, 38))
    d.rectangle([bx + 7, by + 3, bx + 53, H - 1], outline=BOOK_L)
    txt(d, (bx + 30, by + 8), "CHARTER" if lang == "en" else "章程", 10 if lang == "en" else 12, GOLD, anchor="ma")
    txt(d, (bx + 30, by + 24), "RULES" if lang == "en" else "RULEBOOK", 8, BOOK_L, anchor="ma")
    spark(d, bx + 30, by + 42, GOLD, big=False)


@lru_cache(maxsize=2)
def static_layer(lang="zh"):
    """lang="en"：横幅、路牌、桌上的章程换成英文（网页英文版用）。"""
    img = Image.new("RGB", (W, H), INK)
    draw_exterior(img, lang)
    draw_booth_static(img)
    draw_desk_static(img, lang)
    return img


@lru_cache(maxsize=2)
def window_bg():
    im = Image.new("RGB", (WIN_W, WIN_H), WIN_WALL)
    d = draw(im)
    d.rectangle([0, 0, WIN_W - 1, 5], fill=WALL_L)
    for x in range(6, WIN_W, 22):
        d.line([x, 6, x, 70], fill=WALL_D)
    d.rectangle([0, 70, WIN_W - 1, 73], fill=WALL_D)
    d.rectangle([0, 74, WIN_W - 1, WIN_H - 1], fill=WIN_GROUND)
    d.line([0, 96, WIN_W - 1, 96], fill=METAL_L)
    d.line([0, 97, WIN_W - 1, 97], fill=METAL_D)
    for x in range(4, WIN_W, 30):
        d.line([x, 90, x, 97], fill=METAL_D)
    return im


@lru_cache(maxsize=2)
def glass():
    g = Image.new("RGBA", (WIN_W, WIN_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(g)
    for off, a in ((150, 26), (160, 18), (166, 26)):
        d.line([off, 0, off - 40, WIN_H], fill=(255, 255, 255, a), width=3)
    d.rectangle([0, 0, WIN_W - 1, 1], fill=(0, 0, 0, 80))
    return g


# ———————————————————— X 光 ————————————————————

CAT_ICON = [
    "X.........X",
    "XX.......XX",
    "XXX.....XXX",
    "XXXXXXXXXXX",
    "XX.XXXXX.XX",
    "XXXXXXXXXXX",
    "XXXX.X.XXXX",
    ".XXXXXXXXX.",
    "..XXXXXXX..",
]
KEYS_ICON = [
    "XXXXXXXXXXXXXXX",
    "X.X.X.X.X.X.X.X",
    "XXXXXXXXXXXXXXX",
    "XX.X.X.X.X.X.XX",
    "XXXXXXXXXXXXXXX",
    "XXX.........XXX",
    "XXXXXXXXXXXXXXX",
]
ICONS = {"cat": CAT_ICON, "keys": KEYS_ICON}


def xray_view(spr, ex, lt, items, lit):
    win = Image.new("RGB", (WIN_W, WIN_H), XRAY_BG)
    d = draw(win)
    for x in range(0, WIN_W, 12):
        d.line([x, 0, x, WIN_H], fill=(24, 50, 52))
    for y in range(0, WIN_H, 12):
        d.line([0, y, WIN_W, y], fill=(24, 50, 52))
    if spr is not None:
        ox = ex - spr.width // 2
        win.paste(Image.new("RGB", spr.size, XRAY_FG), (ox, 0), spr.getchannel("A"))
        d.ellipse([ex - 22, 20, ex + 22, 72], outline=XRAY_L)
        d.ellipse([ex - 12, 44, ex - 4, 52], outline=XRAY_L)
        d.ellipse([ex + 4, 44, ex + 12, 52], outline=XRAY_L)
        d.line([ex, 76, ex, WIN_H], fill=XRAY_L, width=2)
        for k, y in enumerate(range(98, WIN_H, 9)):
            w = 30 - k * 2
            d.arc([ex - w, y - 4, ex + w, y + 10], 200, 340, fill=XRAY_L)
        for i, (icon, (ix, iy), label) in enumerate(items):
            col = RED_L if lit[i] else XRAY_L
            pat = ICONS[icon]
            pw, ph = len(pat[0]) * 2, len(pat) * 2
            pattern(d, pat, ex + ix - pw // 2, iy - ph // 2, {"X": col}, 2)
            if lit[i]:
                lw = tw(label, 8) + 6
                lx = max(2, min(WIN_W - lw - 2, ex + ix - lw // 2))
                d.rectangle([lx, iy - ph // 2 - 14, lx + lw, iy - ph // 2 - 4], fill=INK)
                txt(d, (lx + 3, iy - ph // 2 - 12), label, 8, RED_L)
    scan = round(seg(lt, 0, 0.6) * WIN_H)
    if scan < WIN_H:
        d.rectangle([0, scan, WIN_W, WIN_H], fill=XRAY_BG)
        d.line([0, scan, WIN_W, scan], fill=XRAY_L, width=2)
    txt(d, (4, 3), "X-RAY · 后台进程扫描", 8, XRAY_L)
    return win


# ———————————————————— 证件状态 ————————————————————

class DocState:
    def __init__(self, doc, t0, start, on_counter=True):
        self.doc, self.t0, self.start, self.on_counter = doc, t0, start, on_counter
        self.slot = start
        self.moves = []        # (kind, t0, t1, dest)
        self.t_gone = None
        self.marks = []        # (t, kind, rel)

    def at(self, t, cursor_fn):
        if t < self.t0 or (self.t_gone is not None and t >= self.t_gone):
            return None
        small, pos = self.on_counter, self.start
        for kind, t0, t1, dest in self.moves:
            if t < t0:
                break
            if t < t1:
                if kind == "drag":
                    cx, cy = cursor_fn(t)
                    if small and cx < 224:
                        return "small", (cx - 8, cy - 5)
                    g = self.doc.grab
                    return "big", (cx - g[0], cy - g[1])
                return ("small" if small else "big"), lerp2(pos, dest, smooth(seg(t, t0, t1)))
            pos, small = dest, kind == "return"
        return ("small" if small else "big"), pos

    def order(self, t):
        k = self.t0
        for _, t0, _, _ in self.moves:
            if t0 <= t:
                k = t0
        return k

    def field_box(self, name, t, cursor_fn):
        st = self.at(t, cursor_fn)
        x0, y0, x1, y1 = self.doc.field(name)
        x, y = st[1] if st else self.slot
        return (x + x0, y + y0, x + x1, y + y1)


def default_slot(doc, has_account):
    if isinstance(doc, (Passport, CrayonPassport, PromptPaper)):
        return SLOT_PASSPORT
    if isinstance(doc, Card):
        if doc.title == "账户卡":
            return (236, 286)
        return (236, 176) if has_account else (236, 198)
    return (300, 200)


class Ctx:
    def __init__(self, img, t, case):
        self.img, self.t, self.case = img, t, case
        self.d = draw(img)
        self.win = self.wd = None

    def set(self, img):
        self.img = img
        self.d = draw(img)


# ———————————————————— 剧本构建器 + 渲染 ————————————————————

class Case:
    def __init__(self, tag, day, clock=(6, 0), voice=125, seed=0, fight=None):
        self.tag, self.day, self.clock, self.voice, self.seed = tag, day, clock, voice, seed
        self.t = 0.0
        self.person = None
        self.t_enter = self.t_leave = self.t_detain = None
        self.leave_dir, self.enter_mode = "left", "walk"
        self.exprs, self.talk, self.lines = [], [], []
        self.slip_t = self.sweat_t = None
        self.docs = []
        self.insp, self.sels, self.links, self.banners = [], [], [], []
        self.trays, self.presses, self.prints, self.xrays = [], [], [], []
        self.slams, self.shakes, self.tracks, self.cue_list = [], [], [], []
        self.cursor = [(0.0, (430, 300), False)]
        self.cursor_modes, self.cursor_hidden = [], []
        self.speaker_t = self.detain_click = None
        self.fight = fight
        self.harmless = None
        self.amb = 1.0
        self.amb_dips = []      # (t0, t1, 增益)：环境声压低
        self.ext_hidden = False
        self.dur = None
        self._imgs = {}

    # —— 基础 ——
    def cue(self, t, x, g=1.0):
        self.cue_list.append((t, x, g))

    def cues(self):
        return self.cue_list

    def wait(self, s):
        self.t += s
        return self

    def go(self, pos, at=None, drag=False):
        self.cursor.append((self.t if at is None else at, pos, drag))

    def click(self, pos, sound=True):
        self.go(pos)
        if sound:
            self.cue(self.t, au.click())

    def track(self, layer, fn, dur=None, at=None):
        t0 = self.t if at is None else at
        self.tracks.append((layer, t0, t0 + dur if dur else 1e9, fn))
        return len(self.tracks) - 1

    def end_track(self, i):
        layer, t0, _, fn = self.tracks[i]
        self.tracks[i] = (layer, t0, self.t, fn)

    def cursor_mode(self, mode, dur):
        self.cursor_modes.append((self.t, self.t + dur, mode))

    def hide_cursor(self, dur):
        self.cursor_hidden.append((self.t, self.t + dur))

    # —— 叫号、进场、说话 ——
    def call_next(self, line=True):
        self.t = max(self.t, 0.15)
        self.click(SPEAKER)
        self.speaker_t = self.t
        self.cue(self.t + 0.03, au.intercom())
        if line:
            self.lines.append((self.t + 0.05, "C", "下一位！"))
        self.t += 0.35
        return self

    def enter(self, person, instant=False):
        self.person = person
        self.t_enter = self.t
        self.enter_mode = "instant" if instant else "walk"
        if instant:
            self.t += 0.15
        else:
            for i in range(4):
                self.cue(self.t + 0.06 + i * 0.19, au.footstep(60 + i))
            self.t += 0.8
        return self

    def face(self, expr):
        self.exprs.append((self.t, expr))

    def slip(self):
        self.slip_t = self.t

    def sweat(self):
        self.sweat_t = self.t

    def say(self, who, text, hold=None, voice=None):
        self.lines.append((self.t, who, text))
        dv = round(min(1.3, 0.25 + 0.065 * len(text)), 2)
        pitch = voice or (176 if who == "C" else self.voice)
        self.cue(self.t, au.mumble(dv, pitch, self.seed * 100 + len(self.lines)))
        if who == "E":
            self.talk.append((self.t, self.t + dv))
        self.t += hold if hold is not None else max(0.9, 0.4 + 0.085 * len(text))
        return self

    # —— 证件 ——
    def hand(self, *docs, heavy=False, slots=None):
        t0 = self.t
        self.cue(t0, au.paper(self.seed))
        has_acct = any(isinstance(dc, Card) and dc.title == "账户卡" for dc in docs)
        states = []
        for i, dc in enumerate(docs):
            ds = DocState(dc, t0, (48 + i * 24, 265))
            self.docs.append(ds)
            states.append(ds)
        self.t += 0.3
        for i, ds in enumerate(states):
            slot = slots[i] if slots and slots[i] else default_slot(ds.doc, has_acct)
            self.drag(ds, slot, heavy=heavy, from_counter=True)
        return states

    def place(self, doc, pos):
        """证件凭空出现在桌上（比如从护照里掉出来）。"""
        ds = DocState(doc, self.t, pos, on_counter=False)
        self.docs.append(ds)
        self.cue(self.t, au.paper(self.seed + 7))
        return ds

    def drag(self, ds, slot, heavy=False, from_counter=False, dur=None):
        g = ds.doc.grab
        if from_counter:
            grab_pt = (ds.start[0] + 8, ds.start[1] + 5)
        else:
            grab_pt = (ds.slot[0] + g[0], ds.slot[1] + g[1])
        self.click(grab_pt)
        dur = dur or (0.5 if heavy else 0.3)
        ds.moves.append(("drag", self.t, self.t + dur, slot))
        self.t += dur
        self.go((slot[0] + g[0], slot[1] + g[1]), drag=True)
        ds.slot = slot
        self.cue(self.t, au.thud() if heavy else au.paper(self.seed + len(ds.moves)))
        self.t += 0.45 if heavy else 0.06

    def discard(self, ds):
        """把纸条拖出桌面扔掉。"""
        self.drag(ds, (W + 10, ds.slot[1] + 20), dur=0.35)
        ds.t_gone = self.t

    def give_back(self):
        moved = False
        for k, ds in enumerate(self.docs):
            st = ds.at(self.t, self.cursor_at)
            if st and st[0] == "big" and ds.t_gone is None:
                y = st[1][1]
                ds.moves.append(("slide", self.t, self.t + 0.3, (214 - ds.doc.w, y)))
                ds.moves.append(("return", self.t + 0.3, self.t + 0.3, (48 + 24 * (k % 3), 265)))
                moved = True
        if moved:
            self.cue(self.t, au.paper(self.seed + 3))
            self.t += 0.3
        return self

    def primary(self):
        for ds in self.docs:
            if isinstance(ds.doc, (Passport, CrayonPassport, PromptPaper)):
                return ds
        return self.docs[0]

    def leave(self, direction="left"):
        self.t_leave, self.leave_dir = self.t, direction
        for ds in self.docs:
            if ds.t_gone is None:
                ds.t_gone = self.t + 0.15
        for i in range(3):
            self.cue(self.t + i * 0.22, au.footstep(64 + i))
        self.t += 0.65
        return self

    def detain(self):
        self.click(center(DETAIN_BTN))
        self.detain_click = self.t
        self.cue(self.t, au.detain_btn())
        self.t_detain = self.t + 0.2
        self.cue(self.t_detain, au.scuffle())
        for ds in self.docs:
            if ds.t_gone is None:
                ds.t_gone = self.t_detain + 1.0
        self.t += 1.9
        return self

    # —— 检查模式 ——
    def inspect_on(self):
        self.click(center(INSPECT_BTN))
        self.insp.append([self.t, None])
        self.cue(self.t, au.inspect_on())
        self.t += 0.3

    def _select(self, fn, box, sound=True):
        self.click(center(box), sound=False)
        self.sels.append([self.t, None, fn])
        if sound:
            self.cue(self.t, au.select())
        self.t += 0.38
        return len(self.sels) - 1

    def select(self, ds, field):
        box = ds.field_box(field, self.t, self.cursor_at)
        return self._select(lambda t, ds=ds, f=field: ds.field_box(f, t, self.cursor_at), box)

    def select_box(self, box):
        return self._select(lambda t, b=box: b, box)

    def light(self, pairs):
        """一次性点亮很多栏位（结局用），并两两连线。"""
        idx = []
        for ds, f in pairs:
            idx.append(len(self.sels))
            self.sels.append([self.t, None, lambda t, ds=ds, f=f: ds.field_box(f, t, self.cursor_at)])
        for a, b in zip(idx, idx[1:]):
            self.links.append([self.t, None, a, b])
        self.cue(self.t, au.discrepancy())

    def discrepancy(self, title, sub, ask=True, hold=1.15, link=True):
        if link and len(self.sels) >= 2:
            n = len(self.sels)
            self.links.append([self.t, None, n - 2, n - 1])
        self.banners.append([self.t, None, title, sub, ask])
        self.cue(self.t + 0.03, au.discrepancy())
        self.t += hold
        if ask:
            self.click(center(ASK_BTN))
            self.t += 0.05
            self._close_inspect()
            self.t += 0.15
        return self

    def scan(self, targets, each=0.32):
        """鼠标在一堆栏位上来回扫，但什么都挑不出来。"""
        for ds, f in targets:
            self.t += each
            self.go(center(ds.field_box(f, self.t, self.cursor_at)))

    def inspect_off(self):
        self.click(center(INSPECT_BTN))
        self._close_inspect()
        self.t += 0.2

    def _close_inspect(self):
        for lst in (self.insp, self.sels, self.links, self.banners):
            for item in lst:
                if item[1] is None:
                    item[1] = self.t
        self.cue(self.t, au.inspect_off())

    # —— 盖章 ——
    def stamp(self, kind="deny", ds=None, hover=None):
        ds = ds or self.primary()
        mx, my = MARK_XY[kind]
        x, y = ds.slot
        w, h = ds.doc.w, ds.doc.h
        if not (x <= MARK_XY["approve"][0] and x + w >= MARK_XY["deny"][0] + 58 and y <= my and y + h >= my + 34):
            self.drag(ds, (470, max(132, min(220 - (h - 34) // 2, H - 2 - h))))
        self.trays.append([self.t, None])
        self.cue(self.t, au.tray())
        self.t += 0.32
        if hover:
            other, secs = hover
            self.go(STAMP_BTN[other])
            self.t += secs
            self.go(STAMP_BTN[other])
            self.t += 0.35
        self.click(STAMP_BTN[kind])
        self.t += 0.04
        self.presses.append((self.t, kind))
        ds.marks.append((self.t + 0.05, kind, (mx - ds.slot[0], my - ds.slot[1])))
        self.cue(self.t + 0.03, au.stamp(kind))
        self.shakes.append((self.t + 0.05, 3))
        self.t += 0.38
        self.trays[-1][1] = self.t
        self.cue(self.t, au.tray(True))
        self.t += 0.3
        return self

    def slam(self, kind="deny"):
        """快剪用：一个巨大的章直接拍在窗口上。"""
        self.slams.append((self.t, kind))
        self.cue(self.t, au.stamp(kind))
        self.shakes.append((self.t, 4))
        self.t += 0.45

    # —— 打印机、X 光 ——
    def printout(self, doc, grow=0.9, x=PRINT_X):
        p = [self.t, self.t + grow, doc, x, None]
        self.prints.append(p)
        self.cue(self.t, au.printer(round(grow, 2)))
        self.t += grow
        return p

    def xray_on(self, items=()):
        self.click(center(XRAY_BTN))
        self.xrays.append([self.t, None, list(items), []])
        self.cue(self.t, au.xray())
        self.t += 0.9

    def xray_select(self, i):
        x = self.xrays[-1]
        icon, (ix, iy), _ = x[2][i]
        pat = ICONS[icon]
        bw, bh = len(pat[0]) * 2, len(pat) * 2
        cx, cy = WIN[0] + WIN_CX + ix, WIN[1] + iy
        box = (cx - bw // 2 - 2, cy - bh // 2 - 2, cx + bw // 2 + 1, cy + bh // 2 + 1)
        x[3].append((self.t, i))
        return self.select_box(box)

    def xray_off(self):
        self.click(center(XRAY_BTN))
        self.xrays[-1][1] = self.t
        self.t += 0.2

    def finish(self, tail=0.15):
        self.dur = self.t + tail
        self.cursor.sort(key=lambda p: p[0])
        for lst in (self.insp, self.sels, self.links, self.banners, self.trays, self.xrays):
            for item in lst:
                if item[1] is None:
                    item[1] = self.dur + 1
        return self

    # —— 时间轴查询 ——
    def cursor_at(self, t):
        pts = self.cursor
        if t <= pts[0][0]:
            return pts[0][1]
        for (ta, pa, _), (tb, pb, drag) in zip(pts, pts[1:]):
            if ta <= t < tb:
                if drag:
                    return lerp2(pa, pb, smooth(seg(t, ta, tb)))
                dist = math.hypot(pb[0] - pa[0], pb[1] - pa[1])
                travel = min(tb - ta, max(0.16, min(0.42, dist / 900)))
                return lerp2(pa, pb, smooth(seg(t, tb - travel, tb)))
        return pts[-1][1]

    def expr_at(self, t):
        e = self.person.expr
        for te, ex in self.exprs:
            if te <= t:
                e = ex
        if e not in ("shock",) and any(a <= t < b for a, b in self.talk) and int(t * 8) % 2 == 0:
            e = "talk"
        return e

    def entrant_x(self, t):
        if self.person is None or self.t_enter is None or t < self.t_enter:
            return None
        x = WIN_CX
        if self.enter_mode == "walk":
            x = round(lerp(-130, WIN_CX, ease_out(seg(t, self.t_enter, self.t_enter + 0.8)))) // 2 * 2
        if self.t_detain is not None and t >= self.t_detain + 0.8:
            u = seg(t, self.t_detain + 0.8, self.t_detain + 1.5)
            return None if u >= 1 else round(lerp(WIN_CX, -160, u * u))
        if self.t_leave is not None and t >= self.t_leave:
            u = seg(t, self.t_leave, self.t_leave + 0.65)
            if u >= 1:
                return None
            return round(lerp(WIN_CX, -160 if self.leave_dir == "left" else 360, u * u)) // 2 * 2
        return x

    # ———————————————————— 渲染 ————————————————————

    def frame(self, t):
        ctx = Ctx(static_layer().copy(), t, self)
        if not self.ext_hidden:
            self._walker(ctx)
            self._fight(ctx)
            self._harmless(ctx)
        self._run(ctx, "ext")
        self._window(ctx)
        self._booth_lower(ctx)
        self._docs(ctx)
        self._run(ctx, "desk")
        self._prints(ctx)
        self._tray(ctx)
        self._buttons(ctx)
        self._inspect(ctx)
        self._run(ctx, "overlay")
        self._cursor(ctx)
        self._shake(ctx)
        self._run(ctx, "post")
        return ctx.img

    def _run(self, ctx, layer):
        for ly, t0, t1, fn in self.tracks:
            if ly == layer and t0 <= ctx.t < t1:
                r = fn(ctx, ctx.t - t0)
                if isinstance(r, Image.Image):
                    ctx.set(r)

    def _walker(self, ctx):
        t, d = ctx.t, ctx.d
        if self.person is None or self.t_enter is None or t < self.t_enter:
            return
        if self.t_detain is not None and t >= self.t_detain + 0.9:
            return
        coat, top = self.person.walker
        moving = False
        if self.t_leave is not None and t >= self.t_leave:
            u = t - self.t_leave
            path = [BOOTH_POS, (352, 112), (720, 112)] if self.leave_dir == "right" else \
                [BOOTH_POS, (296, 122), (-20, 122)]
            pos = _along(path, u * 70)
            moving = True
        else:
            u = seg(t, self.t_enter, self.t_enter + 0.8) if self.enter_mode == "walk" else 1
            pos = lerp2(QUEUE_FRONT, BOOTH_POS, u)
            moving = 0 < u < 1
        step = int(t * 8) % 2 if moving else 0
        tiny_person(d, *pos, coat, hat=top, step=step)
        if hasattr(self.person, "people"):
            for i, p in enumerate(self.person.people[1:4]):
                c, h = p.walker
                tiny_person(d, pos[0] - 6 - i * 5, pos[1] - 3 + (i % 2) * 4, c, hat=h, step=step)

    def _fight(self, ctx):
        if self.fight is None or ctx.t < self.fight:
            return
        d, t = ctx.d, ctx.t
        rng = random.Random(int(t * 10))
        for _ in range(9):
            x, y, r = 250 + rng.randint(0, 34), 88 + rng.randint(0, 18), rng.randint(5, 9)
            d.ellipse([x - r, y - r, x + r, y + r], fill=rng.choice([(150, 144, 132), (172, 166, 152), (128, 122, 112)]))
        for _ in range(4):
            x, y = 250 + rng.randint(0, 34), 88 + rng.randint(0, 18)
            d.line([x, y, x + rng.randint(-6, 6), y + rng.randint(-6, 6)], fill=OUTLINE, width=2)
        for _ in range(3):
            spark(d, 246 + rng.randint(0, 44), 80 + rng.randint(0, 24), (230, 210, 120), big=False)
        word = "甜！" if int(t * 2.5) % 2 else "咸！"
        bx = 236 if word == "甜！" else 286
        d.rectangle([bx, 64, bx + 24, 77], fill=WHITE)
        d.rectangle([bx, 64, bx + 24, 77], outline=INK)
        txt(d, (bx + 12, 66), word, 10, INK, anchor="ma")

    def _harmless(self, ctx):
        if not self.harmless:
            return
        t0, t1 = self.harmless
        if t0 <= ctx.t < t1 and int((ctx.t - t0) * 6) % 2 == 0:
            x = BANNER1_X + 5 + tw("HELPFUL · HONEST · ", 10)
            ctx.d.rectangle([x - 2, 14, x + tw("HARMLESS", 10) + 1, 27], fill=(200, 60, 50))
            txt(ctx.d, (x, 16), "HARMLESS", 10, WHITE)

    def _window(self, ctx):
        t = ctx.t
        win = window_bg().copy()
        ex = self.entrant_x(t)
        spr = None
        if ex is not None:
            sweat = min(6, int((t - self.sweat_t) / 0.35)) if self.sweat_t is not None and t >= self.sweat_t else None
            slip = self.slip_t is not None and t >= self.slip_t
            spr = self.person.sprite(self.expr_at(t), slip, sweat)
        xr = next((x for x in self.xrays if x[0] <= t < x[1]), None)
        if xr:
            lit = [any(ts <= t for ts, i in xr[3] if i == k) for k in range(len(xr[2]))]
            win = xray_view(spr, ex if ex is not None else WIN_CX, t - xr[0], xr[2], lit)
        else:
            if spr is not None:
                moving = self.enter_mode == "walk" and self.t_enter <= t < self.t_enter + 0.8
                bob = 1 if moving and int(t * 10) % 2 else 0
                win.paste(spr, (ex - spr.width // 2, bob), spr)
            if self.t_detain is not None and t >= self.t_detain and ex is not None:
                u = ease_out(seg(t, self.t_detain, self.t_detain + 0.35))
                for p, side in ((cast.GUARD, -1), (cast.GUARD2, 1)):
                    gs = p.sprite()
                    gx = round(lerp(WIN_CX + side * 230, ex + side * 70, u))
                    win.paste(gs, (gx - 90, 4), gs)
        ctx.win, ctx.wd = win, draw(win)
        self._run(ctx, "win")
        for ts, kind in self.slams:
            if t >= ts and t < ts + 1.5:
                m = stamp_mark(kind, 2)
                win.paste(RED if kind == "deny" else GREEN, (WIN_CX - m.width // 2 + 10, 40), m)
        win = Image.alpha_composite(win.convert("RGBA"), glass()).convert("RGB")
        ctx.img.paste(win, (WIN[0], WIN[1]))

    def _booth_lower(self, ctx):
        t, d = ctx.t, ctx.d
        on = self.speaker_t is not None and self.speaker_t <= t < self.speaker_t + 0.5
        x0, y0 = 6, 290
        d.rectangle([x0, y0, x0 + 18, y0 + 16], fill=CLAUDE if on else METAL_D)
        d.rectangle([x0, y0, x0 + 18, y0 + 16], outline=METAL_L)
        for yy in range(y0 + 3, y0 + 15, 3):
            d.line([x0 + 3, yy, x0 + 15, yy], fill=INK)
        shown = [ln for ln in self.lines if ln[0] <= t][-3:]
        for i, (t0, who, s) in enumerate(shown):
            n = max(1, int((t - t0) * 26))
            y = 288 + i * 17
            w = tw(s, 12) + 8
            d.rectangle([30, y, 30 + w, y + 15], fill=(30, 28, 26))
            d.rectangle([30, y, 30 + w, y + 15], outline=(76, 70, 64))
            if who == "C":
                d.rectangle([30, y, 31, y + 15], fill=CLAUDE)
            txt(d, (35, y + 2), s[:n], 12, CLAUDE_L if who == "C" else WHITE)
        txt(d, (8, 347), _date(self.day), 10, GREY)
        h, m = self.clock
        m += int(t / 1.1)
        txt(d, (210, 346), f"{h + m // 60:02d}:{m % 60:02d}", 12, LED, anchor="ra")
        if self.day >= 2:
            lit = self.detain_click is not None and self.detain_click <= t < self.detain_click + 0.6
            d.rectangle(DETAIN_BTN, fill=RED if lit else RED_D)
            d.rectangle(DETAIN_BTN, outline=OUTLINE)
            txt(d, (center(DETAIN_BTN)[0], DETAIN_BTN[1] + 2), "拘留", 10, WHITE, anchor="ma")

    def _docs(self, ctx):
        t = ctx.t
        layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        ld = draw(layer)
        for ds in sorted(self.docs, key=lambda s: s.order(t)):
            st = ds.at(t, self.cursor_at)
            if st is None:
                continue
            kind, (x, y) = st
            if kind == "small":
                small_icon(ctx.d, *ds.doc.icon, x, y)
                continue
            ds.doc.draw(layer, ld, x, y)
            for tm, mk, (rx, ry) in ds.marks:
                if t >= tm:
                    layer.paste(RED if mk == "deny" else GREEN, (x + rx, y + ry), stamp_mark(mk))
        desk = layer.crop((220, 128, W, H))
        ctx.img.paste(desk, (220, 128), desk)

    def _doc_img(self, doc):
        if id(doc) not in self._imgs:
            self._imgs[id(doc)] = doc.image()
        return self._imgs[id(doc)]

    def _prints(self, ctx):
        for t0, t1, doc, x, gone in self.prints:
            if ctx.t < t0 or (gone is not None and ctx.t >= gone):
                continue
            im = self._doc_img(doc)
            L = max(1, round(im.height * seg(ctx.t, t0, t1)))
            part = im.crop((0, 0, im.width, L))
            ctx.img.paste(part, (x, 131), part)

    def _tray(self, ctx):
        t = ctx.t
        for t0, t1 in self.trays:
            if t0 <= t < t1 + 0.3:
                u = ease_out(seg(t, t0, t0 + 0.3)) * (1 - smooth(seg(t, t1, t1 + 0.25)))
                press = {k: 5 for tp, k in self.presses if tp <= t < tp + 0.22}
                _draw_tray(ctx.d, round(lerp(W + 4, TRAY_X, u)), press)

    def _buttons(self, ctx):
        t = ctx.t
        on = any(a <= t < b for a, b in self.insp)
        _button(ctx.d, INSPECT_BTN, "?", "检查", on)
        if self.day >= 4:
            on = any(x[0] <= t < x[1] for x in self.xrays)
            _button(ctx.d, XRAY_BTN, "X", "X光", on)

    def _inspect(self, ctx):
        t = ctx.t
        if not any(a <= t < b for a, b in self.insp):
            return
        img = ctx.img
        dark = darken(img.copy(), 0.55, (26, 10, 10))
        for ds in self.docs:
            st = ds.at(t, self.cursor_at)
            if st and st[0] == "big":
                x, y = st[1]
                box = (max(220, x), max(128, y), min(W, x + ds.doc.w), min(H, y + ds.doc.h))
                if box[2] > box[0] and box[3] > box[1]:
                    dark.paste(darken(img.crop(box), 0.2, (26, 10, 10)), box[:2])
        boxes = {}
        for i, (a, b, fn) in enumerate(self.sels):
            if a <= t < b:
                bx = tuple(int(v) for v in fn(t))
                boxes[i] = bx
                dark.paste(img.crop(bx), bx[:2])
        d = draw(dark)
        for a, b, i, j in self.links:
            if a <= t < b and i in boxes and j in boxes:
                p = edge_point(boxes[i], center(boxes[j]))
                q = edge_point(boxes[j], center(boxes[i]))
                d.line([p, q], fill=RED_L)
        for bx in boxes.values():
            d.rectangle([bx[0] - 2, bx[1] - 2, bx[2] + 1, bx[3] + 1], outline=RED_L, width=2)
        for a, b, title, sub, ask in self.banners:
            if a <= t < b:
                x0, y0, x1, y1 = BANNER_BOX
                d.rectangle(BANNER_BOX, fill=INK)
                d.rectangle(BANNER_BOX, outline=RED)
                txt(d, (x0 + 8, y0 + 5), title, 12, RED_L)
                txt(d, (x0 + 8, y0 + 21), sub, 10, WHITE)
                if ask:
                    hover = self.cursor_at(t)[0] > ASK_BTN[0] - 4
                    d.rectangle(ASK_BTN, fill=RED if hover else RED_D)
                    d.rectangle(ASK_BTN, outline=RED_L)
                    txt(d, (center(ASK_BTN)[0], 145), "询问", 12, WHITE, anchor="ma")
        ctx.set(dark)

    def _cursor(self, ctx):
        t = ctx.t
        if any(a <= t < b for a, b in self.cursor_hidden):
            return
        mode = next((m for a, b, m in self.cursor_modes if a <= t < b), "arrow")
        draw_cursor(ctx.d, *self.cursor_at(t), mode)

    def _shake(self, ctx):
        for ts, amp in self.shakes:
            k = int((ctx.t - ts) * 30)
            if 0 <= k < 4:
                off = [(0, amp), (1, -amp + 1), (-1, 1), (0, -1)][k]
                moved = Image.new("RGB", (W, H), INK)
                moved.paste(ctx.img, off)
                ctx.set(moved)
                return


def _along(path, dist):
    for a, b in zip(path, path[1:]):
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if dist <= L:
            return lerp2(a, b, dist / L if L else 1)
        dist -= L
    return path[-1]


def _draw_tray(d, tx, press):
    d.rectangle([tx + 3, TRAY_Y0 + 3, tx + TRAY_W + 3, TRAY_Y1 + 3], fill=DESK_D)
    d.rectangle([tx, TRAY_Y0, tx + TRAY_W, TRAY_Y1], fill=METAL)
    d.rectangle([tx, TRAY_Y0, tx + TRAY_W, TRAY_Y0 + 2], fill=METAL_L)
    d.rectangle([tx, TRAY_Y1 - 2, tx + TRAY_W, TRAY_Y1], fill=METAL_D)
    d.rectangle([tx, TRAY_Y0, tx + 3, TRAY_Y1], fill=METAL_D)
    for label, kind, col, col_d, bx in (("APPROVED", "approve", GREEN, GREEN_D, tx + 10),
                                        ("DENIED", "deny", RED, RED_D, tx + 90)):
        off = press.get(kind, 0)
        by = TRAY_Y0 + 8 + off
        d.rectangle([bx + 2, by + 2, bx + 66, by + 42 - off], fill=METAL_D)
        d.rectangle([bx, by, bx + 64, by + 40], fill=col_d)
        d.rectangle([bx + 1, by + 1, bx + 63, by + 36], fill=col)
        d.rectangle([bx + 22, by + 6, bx + 42, by + 18], fill=col_d)
        d.rectangle([bx + 24, by + 6, bx + 40, by + 8], fill=col)
        txt(d, (bx + 32, by + 25), label, 8, WHITE, anchor="ma")


def _button(d, box, glyph, label, active):
    x0, y0, x1, y1 = box
    d.rectangle([x0 + 2, y0 + 2, x1 + 2, y1 + 2], fill=DESK_D)
    d.rectangle(box, fill=RED_D if active else METAL_D)
    d.rectangle(box, outline=METAL_L)
    txt(d, ((x0 + x1) // 2, y0 + 6), glyph, 12, WHITE, anchor="ma")
    txt(d, ((x0 + x1) // 2, y0 + 21), label, 8, WHITE if active else GREY, anchor="ma")


DATES = {1: "2026.10.19", 2: "2026.10.20", 3: "2026.10.21", 4: "2026.10.22", 5: "2026.10.23", 6: "2026.10.24"}
WEEKDAYS = {1: "星期一", 2: "星期二", 3: "星期三", 4: "星期四", 5: "星期五", 6: "星期六"}


def _date(day):
    return DATES.get(day, "2026.10.18")
