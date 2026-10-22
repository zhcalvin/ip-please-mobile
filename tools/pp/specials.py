"""个别桥段专用的画面轨道：地址卡堆、手风琴护照、蒸馏大军 + 狙击、规则书特写。"""
import random

from PIL import Image

from . import audio as au
from .base import (BOOK, BOOK_L, GOLD, H, INK, PAPER, PAPER_D, RED, RED_D, RED_L, TEXT, TEXT_L, W, WHITE, big_text,
                   darken, draw, ease_out, lerp, seg, spark, txt)
from .booth import tiny_person
from .docs import AddressCard


def address_pile(case, n=37, dur=1.6):
    """桌上“啪啪啪”摞起 n 张一模一样的地址卡。"""
    rng = random.Random(7)
    spots = [(452 + rng.randint(-30, 30), 196 + rng.randint(-14, 50)) for _ in range(n)]
    card = AddressCard()
    step = dur / n
    for i in range(0, n, 2):
        case.cue(case.t + i * step, au.paper(i % 12), 0.7)

    def fn(ctx, lt):
        k = min(n, int(lt / step) + 1)
        for i in range(k):
            x, y = spots[i]
            fall = 1 - ease_out(seg(lt, i * step, i * step + 0.08))
            card.draw(ctx.img, ctx.d, x, y - round(fall * 16))
        big_text(ctx.img, 590, 270, f"×{k}", 12, 2, RED_L, shadow=INK)
    return fn


NAMES = ["KEVIN", "小王", "TONY", "阿强", "LUCY", "老张", "MOMO", "大刘", "JACK", "小美", "ERIC", "阿杰",
         "AMY", "胖虎", "LEO", "小林", "MIA", "二狗", "SAM", "阿珍", "BEN", "老李", "IVY", "小赵"]


def accordion(case, x, y, w=152, dur=2.0, total=1000):
    """护照像手风琴一样往下展开，上面写满持证人。"""
    rng = random.Random(3)
    rows = [f"#{i:04d}  {rng.choice(NAMES)}" for i in range(1, 80)]
    for k in range(6):
        case.cue(case.t + k * dur / 6, au.paper(20 + k), 0.8)

    def fn(ctx, lt):
        d = ctx.d
        L = round(lerp(0, H - y + 30, ease_out(seg(lt, 0, dur))))
        scroll = max(0.0, lt - dur) * 40
        d.rectangle([x + 2, y + 2, x + w + 1, y + L + 1], fill=(56, 47, 42))
        d.rectangle([x, y, x + w - 1, y + L], fill=PAPER)
        for fy in range(y + 22, y + L, 22):
            d.line([x, fy, x + w - 1, fy], fill=PAPER_D)
        for i, s in enumerate(rows):
            ry = y + 6 + i * 11 - int(scroll)
            if y + 2 <= ry <= y + L - 10:
                txt(d, (x + 8, ry), s, 8, TEXT)
        d.rectangle([x + w - 74, y + 4, x + w - 6, y + 18], fill=RED_D)
        txt(d, (x + w - 40, y + 7), f"共 {total:,} 人", 8, WHITE, anchor="ma")
    return fn


class Clones:
    """蒸馏大军：一列长得一模一样的小人冲向边境，被 429 一个个拦下。"""

    def __init__(self, n=8, first_hit=1.3, gap=0.6, speed=34):
        self.items = []
        for i in range(n):
            th = first_hit + i * gap
            ts = th - 1.1
            x0 = 228 + (i % 3) * 22
            y = 104 + (i * 7) % 18
            self.items.append((ts, x0, y, speed, th))

    def pos(self, i, t):
        ts, x0, y, v, th = self.items[i]
        if t < ts:
            return None
        if t < th:
            return x0 + v * (t - ts), y, "run"
        xh = x0 + v * (th - ts)
        if t < th + 0.7:
            return xh, y, "hit"
        x = xh - v * 0.9 * (t - th - 0.7)
        return (x, y, "back") if x > -10 else None

    def target(self, i):
        ts, x0, y, v, th = self.items[i]
        return round(x0 + v * (th - ts)), y - 6

    def schedule(self, case):
        t0 = case.t
        for i, (_, _, _, _, th) in enumerate(self.items):
            case.go(self.target(i), at=t0 + th)
            case.cue(t0 + th, au.gunshot(), 0.5)
            case.shakes.append((t0 + th, 2))
        return t0

    def track(self):
        def fn(ctx, lt):
            d = ctx.d
            for i in range(len(self.items)):
                p = self.pos(i, lt)
                if p is None:
                    continue
                x, y, state = p
                step = int(lt * 10) % 2 if state != "hit" else 0
                coat = (100, 100, 100) if state != "hit" else (150, 150, 150)
                tiny_person(d, round(x), y, coat, hat=(42, 34, 31), step=step, back=state == "back")
                if state == "hit":
                    rise = round(seg(lt, self.items[i][4], self.items[i][4] + 0.7) * 6)
                    d.rectangle([round(x) - 10, y - 24 - rise, round(x) + 10, y - 15 - rise], fill=WHITE)
                    txt(d, (round(x), y - 23 - rise), "429", 8, RED, anchor="ma")
        return fn


def alarm(dur):
    def fn(ctx, lt):
        a = 0.12 + 0.1 * (int(lt * 3) % 2)
        img = Image.blend(ctx.img, Image.new("RGB", (W, H), (180, 20, 20)), a)
        d = draw(img)
        if int(lt * 3) % 2 == 0 or lt > dur - 1:
            d.rectangle([170, 44, 470, 62], fill=INK)
            d.rectangle([170, 44, 470, 62], outline=RED_L)
            txt(d, (320, 49), "警报：检测到批量请求（蒸馏）", 10, RED_L, anchor="ma")
        return img
    return fn


def rulebook(lines_left, big_lines, note=""):
    """规则书特写：整屏压暗，中间摊开一本书。"""
    def fn(ctx, lt):
        img = darken(ctx.img, 0.72)
        d = draw(img)
        bw, bh = 400, 230
        x0 = (W - bw) // 2
        y0 = round(lerp(H + 10, (H - bh) // 2, ease_out(seg(lt, 0, 0.3))))
        d.rectangle([x0 - 6, y0 - 6, x0 + bw + 6, y0 + bh + 6], fill=BOOK)
        d.rectangle([x0 - 6, y0 - 6, x0 + bw + 6, y0 + bh + 6], outline=BOOK_L)
        d.rectangle([x0, y0, x0 + bw // 2 - 2, y0 + bh], fill=PAPER)
        d.rectangle([x0 + bw // 2 + 2, y0, x0 + bw, y0 + bh], fill=PAPER)
        d.line([x0 + bw // 2, y0, x0 + bw // 2, y0 + bh], fill=PAPER_D, width=3)
        spark(d, x0 + 24, y0 + 22, GOLD, big=False)
        txt(d, (x0 + 36, y0 + 16), "CLAUDE 章程", 12, TEXT)
        for i, s in enumerate(lines_left):
            txt(d, (x0 + 16, y0 + 44 + i * 16), s, 10, TEXT_L if i else TEXT)
        for i in range(5):
            d.rectangle([x0 + 16, y0 + 140 + i * 12, x0 + bw // 2 - 20 - (i * 13) % 40, y0 + 143 + i * 12],
                        fill=PAPER_D)
        if lt > 0.5:
            for i, s in enumerate(big_lines):
                big_text(img, x0 + bw * 3 // 4, y0 + 64 + i * 40, s, 12, 2, RED_D)
        if note and lt > 1.0:
            txt(d, (x0 + bw * 3 // 4, y0 + bh - 26), note, 8, TEXT_L, anchor="ma")
        return img
    return fn
