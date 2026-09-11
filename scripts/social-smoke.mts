import nacl from "tweetnacl";
import bs58 from "bs58";

const BASE = "http://localhost:3001/api/v1";
const j = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) });

async function signInOut(): Promise<{ wallet: string; token: string }> {
  const kp = nacl.sign.keyPair();
  const wallet = bs58.encode(kp.publicKey);
  const nonceRes = await fetch(`${BASE}/auth/nonce`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet }),
  });
  const { nonce } = (await nonceRes.json()) as { nonce: string };
  const message = `FolioX Social\nWallet: ${wallet}\nNonce: ${nonce}`;
  const signature = bs58.encode(nacl.sign.detached(Buffer.from(message, "utf8"), kp.secretKey));
  const verifyRes = await fetch(`${BASE}/auth/verify`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet, nonce, signature }),
  });
  const v = (await verifyRes.json()) as { token: string };
  if (!v.token) throw new Error(`verify failed: ${JSON.stringify(v)}`);
  return { wallet, token: v.token };
}

const alice = await signInOut();
console.log("alice auth OK:", alice.wallet.slice(0, 8) + "…");
const authHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${alice.token}` };

// replay must fail
const replay = await fetch(`${BASE}/auth/verify`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ wallet: alice.wallet, nonce: "x", signature: "y" }),
});
console.log("replay nonce →", replay.status, "(expect 401)");

// profile
const put = await fetch(`${BASE}/me/profile`, {
  method: "PUT", headers: authHeaders,
  body: JSON.stringify({ handle: "smoke_alice", displayName: "Smoke Alice", bio: "e2e smoke", isPublic: true }),
});
console.log("PUT profile →", put.status, JSON.stringify((await put.json()).profile?.handle));

// duplicate handle from a second user → 409
const bob = await signInOut();
const dup = await fetch(`${BASE}/me/profile`, {
  method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bob.token}` },
  body: JSON.stringify({ handle: "smoke_alice" }),
});
console.log("dup handle →", dup.status, "(expect 409)");

// post a thesis on the first indexed basket
const baskets = (await (await fetch(`${BASE}/baskets?limit=1`)).json()) as { data?: Array<{ pubkey: string }> };
const basket = baskets.data?.[0]?.pubkey;
console.log("basket:", basket ?? "NONE");
const postRes = await fetch(`${BASE}/posts`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${alice.token}` },
  body: JSON.stringify({ kind: "thesis", title: "Smoke thesis", body: "This is an end-to-end smoke test thesis post.", basket }),
});
const postBody = await postRes.json();
console.log("POST /posts →", postRes.status, "id:", postBody.post?.id);

// bob follows alice + likes + comments
console.log("follow →", (await fetch(`${BASE}/users/${alice.wallet}/follow`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bob.token}` } })).status);
const like = await fetch(`${BASE}/posts/${postBody.post.id}/like`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bob.token}` } });
console.log("like →", like.status, JSON.stringify(await like.json()));
const comment = await fetch(`${BASE}/posts/${postBody.post.id}/comments`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${bob.token}` },
  body: JSON.stringify({ body: "solid thesis" }),
});
console.log("comment →", comment.status);

// feed shows the thesis; bob's Following scope shows alice
const feed = (await (await fetch(`${BASE}/feed?type=theses`)).json()) as { items: Array<{ kind: string; title: string; likeCount: number; commentCount: number }> };
console.log("feed theses:", JSON.stringify(feed.items.map((i) => ({ title: i.title, likes: i.likeCount, comments: i.commentCount }))));
const followingFeed = (await (await fetch(`${BASE}/feed?scope=following`, { headers: { Authorization: `Bearer ${bob.token}` } })).json()) as { items: unknown[] };
console.log("bob following feed items:", followingFeed.items.length);

// unauthenticated following scope → 401
const noAuth = await fetch(`${BASE}/feed?scope=following`);
console.log("following w/o auth →", noAuth.status, "(expect 401)");

// privacy: alice hides → her thesis disappears from feed for anon viewer
await fetch(`${BASE}/me/profile`, { method: "PUT", headers: authHeaders, body: JSON.stringify({ isPublic: false }) });
const hiddenFeed = (await (await fetch(`${BASE}/feed?type=theses`)).json()) as { items: unknown[] };
console.log("feed after alice went private:", hiddenFeed.items.length, "(expect 0)");
await fetch(`${BASE}/me/profile`, { method: "PUT", headers: authHeaders, body: JSON.stringify({ isPublic: true }) });

// profile reads
const prof = await fetch(`${BASE}/users/${alice.wallet}/profile`);
const profBody = await prof.json();
console.log("profile:", prof.status, JSON.stringify(profBody.stats));
const hist = await fetch(`${BASE}/users/${alice.wallet}/history`);
console.log("history:", hist.status, (await hist.json()).items.length, "trades");
console.log("SMOKE DONE");
