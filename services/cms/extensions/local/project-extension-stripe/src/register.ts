export function getRegistrationPage(publicUrl: string): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Create Account</title>
<style>
	*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
	body{
		font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
		background:#1e3957;color:#fff;
		display:flex;align-items:center;justify-content:center;
		min-height:100vh;padding:20px;
	}
	.card{
		background:rgba(255,255,255,0.08);backdrop-filter:blur(12px);
		border:1px solid rgba(255,255,255,0.12);border-radius:12px;
		padding:40px;width:100%;max-width:420px;
	}
	h1{font-size:24px;font-weight:600;margin-bottom:8px;text-align:center}
	.subtitle{color:rgba(255,255,255,0.6);text-align:center;margin-bottom:28px;font-size:14px}
	label{display:block;font-size:13px;font-weight:500;margin-bottom:6px;color:rgba(255,255,255,0.8)}
	input[type="text"],input[type="email"],input[type="password"]{
		width:100%;padding:10px 14px;border:1px solid rgba(255,255,255,0.2);
		border-radius:8px;background:rgba(255,255,255,0.06);color:#fff;
		font-size:14px;outline:none;transition:border-color .2s;
	}
	input:focus{border-color:rgba(255,255,255,0.5)}
	input::placeholder{color:rgba(255,255,255,0.3)}
	.field{margin-bottom:18px}
	.checkbox-row{display:flex;align-items:flex-start;gap:8px;margin-bottom:24px}
	.checkbox-row input[type="checkbox"]{margin-top:3px;accent-color:#6644ff}
	.checkbox-row label{margin-bottom:0;font-size:13px;color:rgba(255,255,255,0.7);cursor:pointer}
	button[type="submit"]{
		width:100%;padding:12px;border:none;border-radius:8px;
		background:#6644ff;color:#fff;font-size:15px;font-weight:600;
		cursor:pointer;transition:background .2s;
	}
	button[type="submit"]:hover{background:#5533dd}
	button[type="submit"]:disabled{opacity:.5;cursor:not-allowed}
	.error{background:rgba(255,60,60,0.15);border:1px solid rgba(255,60,60,0.3);border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:13px;color:#ff6b6b;display:none}
	.error.show{display:block}
	.success{background:rgba(60,255,120,0.15);border:1px solid rgba(60,255,120,0.3);border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:13px;color:#6bffb0;display:none}
	.success.show{display:block}
	.login-link{text-align:center;margin-top:20px;font-size:13px;color:rgba(255,255,255,0.5)}
	.login-link a{color:rgba(255,255,255,0.8);text-decoration:none}
	.login-link a:hover{text-decoration:underline}
</style>
</head>
<body>
<div class="card">
	<h1>Create Account</h1>
	<p class="subtitle">Start your free trial</p>

	<div id="error" class="error"></div>
	<div id="success" class="success"></div>

	<form id="registerForm" novalidate>
		<div class="field">
			<label for="name">Full Name</label>
			<input type="text" id="name" name="name" placeholder="John Doe" required>
		</div>
		<div class="field">
			<label for="email">Email</label>
			<input type="email" id="email" name="email" placeholder="you@company.com" required>
		</div>
		<div class="field">
			<label for="password">Password</label>
			<input type="password" id="password" name="password" placeholder="Minimum 8 characters" required minlength="8">
		</div>
		<div class="checkbox-row">
			<input type="checkbox" id="terms" name="terms" required>
			<label for="terms">I agree to the Terms of Service and Privacy Policy</label>
		</div>
		<button type="submit" id="submitBtn">Create Account</button>
	</form>

	<p class="login-link">Already have an account? <a href="${publicUrl}/admin/login">Sign in</a></p>
</div>
<script>
(function(){
	var form=document.getElementById('registerForm');
	var errorEl=document.getElementById('error');
	var successEl=document.getElementById('success');
	var submitBtn=document.getElementById('submitBtn');

	form.addEventListener('submit',function(e){
		e.preventDefault();
		errorEl.className='error';
		successEl.className='success';

		var name=document.getElementById('name').value.trim();
		var email=document.getElementById('email').value.trim();
		var password=document.getElementById('password').value;
		var terms=document.getElementById('terms').checked;

		if(!name||!email||!password){showError('All fields are required.');return}
		if(!/^[^@]+@[^@]+\\.[^@]+$/.test(email)){showError('Please enter a valid email.');return}
		if(password.length<8){showError('Password must be at least 8 characters.');return}
		if(!terms){showError('You must accept the terms.');return}

		submitBtn.disabled=true;
		submitBtn.textContent='Creating account...';

		fetch('${publicUrl}/register',{
			method:'POST',
			headers:{'Content-Type':'application/json'},
			body:JSON.stringify({name:name,email:email,password:password})
		}).then(function(r){return r.json().then(function(d){return{ok:r.ok,data:d}})})
		.then(function(res){
			if(res.ok){
				successEl.textContent='Account created! Redirecting to login...';
				successEl.className='success show';
				form.style.display='none';
				setTimeout(function(){window.location.href='${publicUrl}/admin/login'},2000);
			}else{
				showError(res.data.errors?res.data.errors[0].message:res.data.error||'Registration failed');
				submitBtn.disabled=false;
				submitBtn.textContent='Create Account';
			}
		}).catch(function(){
			showError('Network error. Please try again.');
			submitBtn.disabled=false;
			submitBtn.textContent='Create Account';
		});
	});

	function showError(msg){errorEl.textContent=msg;errorEl.className='error show'}
})();
</script>
</body>
</html>`;
}
