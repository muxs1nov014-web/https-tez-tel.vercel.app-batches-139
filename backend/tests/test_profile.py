"""PATCH /auth/me: own login and password change (current password required)."""

from app.services import users


async def test_requires_sign_in(client):
    assert (await client.patch("/api/auth/me", json={"current_password": "x", "password": "y" * 12})).status_code == 401


async def test_viewer_changes_own_login_and_password(client, viewer_h):
    r = await client.patch("/api/auth/me", headers=viewer_h, json={
        "current_password": "secret123", "username": "kassir-yangi", "password": "yangi-parol-123"})
    assert r.status_code == 200 and r.json()["username"] == "kassir-yangi"
    ok = await client.post("/api/auth/login", json={"username": "kassir-yangi", "password": "yangi-parol-123"})
    assert ok.status_code == 200
    old = await client.post("/api/auth/login", json={"username": "t_viewer", "password": "secret123"})
    assert old.status_code == 401


async def test_wrong_current_password_changes_nothing(client, admin_h):
    r = await client.patch("/api/auth/me", headers=admin_h, json={
        "current_password": "wrong", "password": "yangi-parol-123"})
    assert r.status_code == 422 and "Joriy parol" in r.json()["detail"]
    assert (await client.get("/api/auth/me", headers=admin_h)).json()["username"] == "t_admin"


async def test_taken_login_short_password_and_empty_change(client, session, admin_h):
    await users.create_user(session, "band", "secret123456", "Band", "viewer")
    taken = await client.patch("/api/auth/me", headers=admin_h, json={"current_password": "secret123",
                                                                       "username": "band"})
    assert taken.status_code == 409
    short = await client.patch("/api/auth/me", headers=admin_h, json={"current_password": "secret123",
                                                                       "password": "qisqa"})
    assert short.status_code == 422
    empty = await client.patch("/api/auth/me", headers=admin_h, json={"current_password": "secret123"})
    assert empty.status_code == 422
