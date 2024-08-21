document.addEventListener('DOMContentLoaded', function () {
    const currentPage = window.location.pathname;
    const navLinks = document.querySelectorAll('nav ul li a');

    navLinks.forEach(link => {
        if (currentPage.includes(link.getAttribute('href'))) link.classList.add('active');
    });
});
