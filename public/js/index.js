
function configurarLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);  // Adiciona o evento de click no botão de logout
    }
}

function toggleMiniNavbar() {
    const miniNavbar = document.getElementById('mini-navbar');
    // Alterna entre mostrar e esconder a mini navbar
    miniNavbar.style.display = miniNavbar.style.display === 'block' ? 'none' : 'block';
}

