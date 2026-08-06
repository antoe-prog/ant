from __future__ import annotations

from tossquant.ratelimit import RateLimiter, TokenBucket


def test_burst_up_to_capacity_then_empty():
    bucket = TokenBucket(rate_per_sec=1.0, capacity=3)
    assert [bucket.try_acquire() for _ in range(3)] == [True, True, True]
    assert bucket.try_acquire() is False


def test_acquire_waits_for_refill():
    slept: list[float] = []
    bucket = TokenBucket(rate_per_sec=2.0, capacity=1)
    bucket.try_acquire()  # 버킷 비움

    waited = bucket.acquire(sleep=slept.append)

    # rate 2/s 이므로 토큰 하나에 0.5초.
    assert waited > 0
    assert sum(slept) >= 0.49


def test_limiter_routes_by_bucket_name():
    limiter = RateLimiter(
        buckets={"market": TokenBucket(100, capacity=100)},
        default=TokenBucket(100, capacity=100),
    )
    assert limiter.acquire("market") == 0.0
    assert limiter.acquire("unknown-bucket") == 0.0


def test_toss_defaults_have_separate_account_bucket():
    limiter = RateLimiter.toss_defaults()
    # 계좌 버킷은 용량 1이므로 두 번째 호출은 대기해야 한다.
    assert limiter._buckets["account"].try_acquire() is True
    assert limiter._buckets["account"].try_acquire() is False
    # 시세 버킷은 영향받지 않는다.
    assert limiter._buckets["market"].try_acquire() is True
